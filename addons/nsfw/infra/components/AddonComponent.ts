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

		/* Single container: the nsfw plugin owns TF threading and its own multi-process
		 * parallelism/batching internally, so the host no longer fans out to N replicas to
		 * work around tfjs-node's single-flight session. */
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

		/* TF/oneDNN/libuv thread caps — previously used to stop N replicas oversubscribing the host
		 * (8 replicas * 8 threads = 64 vCPUs). With a single container the plugin owns TF threading, so
		 * these are commented out rather than capping the container. Restore if the plugin ever needs
		 * the host to bound its thread pools. */
		const threadEnvs: string[] = [
			// `OMP_NUM_THREADS=8`,
			// `TF_NUM_INTRAOP_THREADS=8`,
			// `TF_NUM_INTEROP_THREADS=1`,
			// `UV_THREADPOOL_SIZE=8`,
		]

		new docker.Container(name, {
			name: n(name),
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

		this.registerOutputs({})
	}
}
