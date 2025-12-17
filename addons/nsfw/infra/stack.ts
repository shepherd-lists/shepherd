import { App, Aws, Duration, Stack, aws_applicationautoscaling, aws_cloudwatch, aws_ec2, aws_ecr_assets, aws_ecs, aws_iam, aws_logs, aws_servicediscovery } from 'aws-cdk-lib'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { Config, ioQueueNames, finalQueueName } from '../../../Config'

/** allow renaming the installation folder to create a new stack */
const addonRoot = new URL('..', import.meta.url).pathname.split('/').at(-2) //e.g. 'nsfw'
const AddonRoot = addonRoot.charAt(0).toUpperCase() + addonRoot.slice(1)

/** import stack params */
const readParam = async (name: string) => {
	const ssm = new SSMClient()
	try {
		return (await ssm.send(new GetParameterCommand({
			Name: `/shepherd/${name}`,
			WithDecryption: true, // ignored if unencrypted
		}))).Parameter!.Value as string // throw undefined
	} catch (e) {
		throw new Error(`Failed to read parameter '${name}' from '${await ssm.config.region()}': ${e.name}:${e.message}`)
	}
}
const vpcId = await readParam('VpcId')
const logGroupName = await readParam('LogGroup')
const clusterName = await readParam('ClusterName')
const namespaceArn = await readParam('NamespaceArn')
const namespaceId = await readParam('NamespaceId')
const inputBucketName = await readParam('InputBucket')

export const createStack = (app: App, config: Config) => {
	const stack = new Stack(app, AddonRoot, {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		description: `${addonRoot} addon stack`,
	})

	/** import stack components from the shepherd stack */
	const vpc = aws_ec2.Vpc.fromLookup(stack, 'vpc', { vpcId })
	const logGroup = aws_logs.LogGroup.fromLogGroupName(stack, 'logGroup', logGroupName)
	const cluster = aws_ecs.Cluster.fromClusterAttributes(stack, 'shepherd-cluster', {
		clusterName,
		vpc,
	})
	const cloudMapNamespace = aws_servicediscovery.PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(stack, 'shepherd.local', {
		namespaceName: 'shepherd.local',
		namespaceArn: namespaceArn,
		namespaceId: namespaceId,
	})

	/** i/o queue names */
	const ioQNames = ioQueueNames(config, addonRoot)
	const finalQName = finalQueueName(config)
	const qPrefix = `https://sqs.${config.region}.amazonaws.com/${Aws.ACCOUNT_ID}/`
	const inputQUrl = qPrefix + ioQNames.input
	const outputQUrl = qPrefix + ioQNames.output
	const finalQUrl = finalQName ? qPrefix + finalQName : undefined //may be undefined if no classifiers


	/** template for a standard addon service */
	interface FargateBuilderProps {
		stack: Stack
		cluster: aws_ecs.ICluster
		logGroup: aws_logs.ILogGroup
		minHealthyPercent?: number
	}
	const createAddonService = (
		name: string,
		{ stack, cluster, logGroup }: FargateBuilderProps,
	) => {
		const Name = name.charAt(0).toUpperCase() + name.slice(1)

		const dockerImage = new aws_ecr_assets.DockerImageAsset(stack, `image${Name}`, {
			directory: new URL('../', import.meta.url).pathname,
			exclude: ['cdk.out', 'infra'],
			target: name === 'nsfw' ? 'nsfw' : 'no-nsfw',
			assetName: `${name}-image`,
			platform: aws_ecr_assets.Platform.LINUX_AMD64,
		})
		const tdef = new aws_ecs.FargateTaskDefinition(stack, `tdef${Name}`, {
			cpu: 2048,
			memoryLimitMiB: 16384, // this was on 30gb, is nsfw still a memory hog?
			runtimePlatform: { cpuArchitecture: aws_ecs.CpuArchitecture.X86_64 },
			family: name,
		})
		tdef.addContainer(`container${Name}`, {
			image: aws_ecs.ContainerImage.fromDockerImageAsset(dockerImage),
			logging: new aws_ecs.AwsLogDriver({
				logGroup,
				streamPrefix: name,
			}),
			containerName: `${name}Container`,
			environment: {
				ADDON_NAME: name,
				SLACK_WEBHOOK: config.slack_webhook!,
				HOST_URL: config.host_url || 'https://arweave.net',
				NUM_FILES: '50',
				TOTAL_FILESIZE_GB: '10',
				AWS_INPUT_BUCKET: inputBucketName,
				AWS_SQS_INPUT_QUEUE: inputQUrl,
				AWS_SQS_OUTPUT_QUEUE: outputQUrl,
				AWS_SQS_SINK_QUEUE: finalQUrl, //may be undefined if no classifiers
				AWS_DEFAULT_REGION: Aws.REGION,
			},
		})
		const fg = new aws_ecs.FargateService(stack, `fg${Name}`, {
			cluster,
			taskDefinition: tdef,
			serviceName: name,
			cloudMapOptions: {
				name,
				cloudMapNamespace,
			},
			desiredCount: 1,
		})

		return fg
	}

	/** create the nsfw service */

	const nsfw = createAddonService(addonRoot, { stack, cluster, logGroup })


	/** permissions */
	nsfw.taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['sqs:*'],
		resources: [
			`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:${ioQNames.input}`,
			`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:${ioQNames.output}`,
			`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:${finalQName}`,
		],
	}))
	nsfw.taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [
			`arn:aws:s3:::${inputBucketName}/*`,
		],
	}))

	/** auto-scaling */

	const metric = new aws_cloudwatch.Metric({
		namespace: 'AWS/SQS',
		metricName: 'ApproximateNumberOfMessagesVisible',
		statistic: 'Average',
		dimensionsMap: {
			QueueName: ioQNames.input,
		},
		period: Duration.minutes(1),
	})

	const scaling = nsfw.autoScaleTaskCount({
		minCapacity: 0,
		maxCapacity: 10,
	})

	scaling.scaleOnMetric(`${AddonRoot}ScaleOut`, {
		metric,
		scalingSteps: [
			{ lower: 1, change: +1 },      // Start with 1 task
			{ lower: 300, change: +1 },    // Add 1 more at 300 msgs
			{ lower: 600, change: +1 },    // Add 1 more at 600 msgs
			{ lower: 1000, change: +2 },   // Add 2 more at 1000 msgs
			{ lower: 1500, change: +2 },   // Add 2 more at 1500 msgs
			{ lower: 2000, change: +3 },   // Add 3 more at 2000 msgs
		],
		adjustmentType: aws_applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
	})

	scaling.scaleOnMetric(`${AddonRoot}ScaleDown`, {
		metric: metric,
		scalingSteps: [
			{ upper: 0, change: -10 },     // 0 messages: remove all tasks
			{ upper: 300, change: -2 },    // <300 messages: remove 2 tasks
			{ upper: 600, change: -1 },    // <600 messages: remove 1 task
			{ upper: 1000, change: -1 },   // <1000 messages: remove 1 task
		],
		adjustmentType: aws_applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
		evaluationPeriods: 2,  // Wait longer before scaling down (mins)
	})


}
