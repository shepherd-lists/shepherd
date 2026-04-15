import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as path from 'path'
import { naming, ioQueueNames, finalQueueName, type Config } from '../../../../Config'

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

		const minioEndpoint = infraRef.getOutput('minioEndpoint') as pulumi.Output<string>
		const sqsEndpoint = infraRef.getOutput('sqsEndpoint') as pulumi.Output<string>
		const lokiEndpoint = infraRef.getOutput('lokiEndpoint') as pulumi.Output<string>

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

		/** Loki logging */
		const lokiLogOpts = lokiEndpoint.apply(_ep => ({
			'loki-url': 'http://localhost:3100/loki/api/v1/push',
			'loki-batch-size': '400',
			'mode': 'non-blocking',
			'max-buffer-size': '5m',
			'loki-retries': '2',
			'loki-max-backoff': '1s',
			'loki-timeout': '3s',
		}))

		const image = new docker.Image(`image-${name}`, {
			build: {
				context: path.join(import.meta.dirname, '../../'),
				builderVersion: docker.BuilderVersion.BuilderBuildKit,
				platform: config.buildPlatform,
				target: name === 'nsfw' ? 'nsfw' : 'no-nsfw',
			},
			imageName: n(name),
			skipPush: true,
		}, childOpts)

		new docker.Container(name, {
			name: n(name),
			image: image.repoDigest,
			networksAdvanced: [{ name: networkName }],
			envs: pulumi.all([awsCompat, sqsEndpoint]).apply(([aws, sqs]) => [
				...aws,
				...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
				`HOST_URL=${config.host_url || 'https://arweave.net'}`,
				`ADDON_NAME=${name}`,
				`NUM_FILES=50`,
				`TOTAL_FILESIZE_GB=10`,
				`AWS_INPUT_BUCKET=shepherd-input`,
				`AWS_SQS_INPUT_QUEUE=${sqs}/000000000000/${ioQNames.input}`,
				`AWS_SQS_OUTPUT_QUEUE=${sqs}/000000000000/${ioQNames.output}`,
				...(finalQName ? [`AWS_SQS_SINK_QUEUE=${sqs}/000000000000/${finalQName}`] : []),
			]),
			logDriver: 'loki',
			logOpts: lokiLogOpts,
			restart: 'unless-stopped',
		}, { ...childOpts, dependsOn: [image] })

		this.registerOutputs({})
	}
}
