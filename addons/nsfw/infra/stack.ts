import { App, Aws, Duration, Stack, aws_cloudwatch, aws_ec2, aws_ecr_assets, aws_ecs, aws_iam, aws_logs, aws_servicediscovery } from 'aws-cdk-lib'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { Config } from '../../../Config'



/** import stack params */
const readParam = async (name: string) => {
	const ssm = new SSMClient()
	return (await ssm.send(new GetParameterCommand({
		Name: `/shepherd/${name}`,
		WithDecryption: true, // ignored if unencrypted
	}))).Parameter!.Value as string // throw undefined
}
const vpcName = await readParam('VpcName')
const logGroupName = await readParam('LogGroup')
const clusterName = await readParam('ClusterName')
const namespaceArn = await readParam('NamespaceArn')
const namespaceId = await readParam('NamespaceId')
const inputQueueUrl = await readParam('InputQueueUrl')
const inputBucketName = await readParam('InputBucket')
const inputAgeMetricProps: aws_cloudwatch.MetricProps = JSON.parse(await readParam('InputMetricProps'))

export const createStack = (app: App, config: Config) => {
	const stack = new Stack(app, 'Nsfw', {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		stackName: 'nsfw',
		description: 'nsfw addon stack',
	})

	/** import stack components from the shepherd stack */
	const vpc = aws_ec2.Vpc.fromLookup(stack, 'vpc', { vpcName })
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
			target: name,
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
				SLACK_WEBHOOK: config.slack_webhook!,
				HOST_URL: config.host_url || 'https://arweave.net',
				NUM_FILES: '50',
				TOTAL_FILESIZE_GB: '10',
				AWS_SQS_INPUT_QUEUE: inputQueueUrl,
				AWS_INPUT_BUCKET: inputBucketName,
				AWS_DEFAULT_REGION: Aws.REGION,
				HTTP_API_URL: 'http://http-api.shepherd.local:84/postupdate',
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

	const nsfw = createAddonService('nsfw', { stack, cluster, logGroup })
	// nsfw.node.addDependency(httpApi)

	/** permissions */
	const inputQueueName = inputQueueUrl.split('/').pop()
	nsfw.taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['sqs:*'],
		resources: [`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:${inputQueueName}`],
	}))
	nsfw.taskDefinition.taskRole.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [
			`arn:aws:s3:::${inputBucketName}/*`,
		],
	}))

	/** auto-scaling */
	const metric = new aws_cloudwatch.Metric(inputAgeMetricProps)
	nsfw.autoScaleTaskCount({
		minCapacity: 1,
		maxCapacity: 10,
	}).scaleToTrackCustomMetric('NsfwScaling', {
		metric,
		targetValue: 60,
		scaleInCooldown: Duration.seconds(60),
		scaleOutCooldown: Duration.seconds(60),
	})
}
