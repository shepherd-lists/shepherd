import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as path from 'path'
import { naming, ioQueueNames, finalQueueName, type Config } from '../../../../Config'
import { lokiLogDriver, lokiLogOpts } from '../../../../infra/components/lokiLogConfig'

export interface AddonComponentArgs {
	config: Config
	stackName: string
	infraRef: pulumi.StackReference
	networkName: pulumi.Output<string>
}

export class AddonComponent extends pulumi.ComponentResource {

	constructor(name: string, args: AddonComponentArgs, opts?: pulumi.ComponentResourceOptions) {
		super('shepherd:addon:AddonComponent', name, {}, opts)

		const childOpts = { ...opts, parent: this }
		const { config, stackName, infraRef, networkName } = args
		const n = (s: string) => naming(stackName, s)

		/* tfjs-node holds one process-wide native session (single-flight inference), so the only way
		 * to use many cores is many processes. Each replica gets a slice of the host's cores via the
		 * TF/oneDNN/libuv thread caps below; replicas * threadsPerReplica should stay <= host vCPUs to
		 * avoid oversubscription. On the 64-vCPU prod host: 8 replicas * 8 threads = 64. */
		/* tfjs-node is single-flight per process, so we run N identical replicas to use multiple cores.
 * 8 replicas * 8 TF threads each = 64 vCPUs on the prod host (see AddonComponent threadsPerReplica). */
		const replicas = 8
		const threadsPerReplica = 8

		const minioEndpoint = infraRef.getOutput('minioEndpoint') as pulumi.Output<string>
		const sqsEndpoint = infraRef.getOutput('sqsEndpoint') as pulumi.Output<string>

		/** derive i/o queue names from config */
		const ioQNames = ioQueueNames(config, name)
		const finalQName = finalQueueName(config)

		/** AWS SDK compatibility with MinIO/ElasticMQ */
		const awsCompat = pulumi.all([minioEndpoint, sqsEndpoint]).apply(([minio, sqs]) => [
			`AWS_ACCESS_KEY_ID=shepherd`,
			`AWS_SECRET_ACCESS_KEY=${config.minioPassword}`,
			`AWS_ENDPOINT_URL_S3=${minio}`,
			`AWS_ENDPOINT_URL_SQS=${sqs}`,
			`AWS_REGION=us-east-1`,
		])

		const addonsDir = path.join(import.meta.dirname, '../../../')
		const image = new docker.Image(`image-${name}`, {
			build: {
				context: addonsDir,
				dockerfile: path.join(addonsDir, 'nsfw/Dockerfile'),
				builderVersion: docker.BuilderVersion.BuilderBuildKit,
				platform: config.buildPlatform,
				target: name,
			},
			imageName: n(name),
			skipPush: true,
		}, childOpts)

		/* Cap each process's TF/oneDNN/libuv pools so N replicas don't each fan out to all 64 cores
		 * and thrash. All replicas share the one input/output queue pair — ElasticMQ load-balances
		 * messages across consumers, so no extra queues are needed. */
		const threadEnvs = [
			`OMP_NUM_THREADS=${threadsPerReplica}`,
			`TF_NUM_INTRAOP_THREADS=${threadsPerReplica}`,
			`TF_NUM_INTEROP_THREADS=1`,
			`UV_THREADPOOL_SIZE=${threadsPerReplica}`,
		]

		for (let i = 0; i < replicas; i++) {
			/* single replica keeps the original name for a clean diff against existing prod state */
			const replicaName = replicas > 1 ? `${name}-${i + 1}` : name
			new docker.Container(replicaName, {
				name: n(replicaName),
				image: image.repoDigest,
				networksAdvanced: [{ name: networkName }],
				envs: pulumi.all([awsCompat, sqsEndpoint]).apply(([aws, sqs]) => [
					...aws,
					...threadEnvs,
					...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
					`HOST_URL=${config.host_url || 'https://arweave.net'}`,
					`ADDON_NAME=${name}`,
					`NUM_FILES=50`,
					`VIDEO_CONCURRENCY=3`,
					`AWS_INPUT_BUCKET=shepherd-input`,
					`AWS_SQS_INPUT_QUEUE=${sqs}/000000000000/${ioQNames.input}`,
					`AWS_SQS_OUTPUT_QUEUE=${sqs}/000000000000/${ioQNames.output}`,
					`AWS_SQS_SINK_QUEUE=${sqs}/000000000000/${finalQName}`,
				]),
				logDriver: lokiLogDriver,
				logOpts: lokiLogOpts,
				restart: 'unless-stopped',
			}, { ...childOpts, dependsOn: [image] })
		}

		this.registerOutputs({})
	}
}
