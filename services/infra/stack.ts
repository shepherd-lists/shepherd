import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { Config } from '../../Config'

/** import params from shepherd regions (London is global store) */
const remoteParam = async (name: string, ssm: SSMClient) => {
	try{
		return (await ssm.send(new GetParameterCommand({
			Name: `/shepherd/${name}`,
			WithDecryption: true, // ignored if unencrypted
		}))).Parameter!.Value as string // throws if undefined
	}catch(e){
		throw new Error(`Failed to get '${name}' from '${await ssm.config.region()}'. ${e.name}:${e.message}`)
	}
}
// console.log('reading remote params...') //--currently no remote params!


/** import params from infra stack */
const readParam = async (paramName: string) => {
	const ssm = new SSMClient() //local region
	return remoteParam(paramName, ssm)
}
console.log('reading params from infra stack...')
const vpcId = await readParam('VpcId')
const rdsEndpoint = await readParam('RdsEndpoint')
const feederQueueUrl = await readParam('FeederQueueUrl')
const inputBucketName = await readParam('InputBucket')
const inputQueueUrl = await readParam('InputQueueUrl') //for feeder to check length
const logGroupName = await readParam('LogGroup')
const albArn = await readParam('AlbArn')

interface ServicesStackProps extends cdk.StackProps {
	config: Config
}

export class ServicesStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: ServicesStackProps) {
		super(scope, id, props)
		const stack = this

		const { config } = props


		/** import shepherd-infra-stack items  */

		const vpc = cdk.aws_ec2.Vpc.fromLookup(stack, 'vpc', { vpcId })
		const alb = cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer.fromLookup(stack, 'alb', { loadBalancerArn: albArn })
		const logGroup = cdk.aws_logs.LogGroup.fromLogGroupName(stack, 'logGroup', logGroupName)


		/** create a cluster for fargates */

		const cluster = new cdk.aws_ecs.Cluster(stack, 'shepherd-services-cluster', {
			vpc,
			clusterName: 'shepherd-services',
			defaultCloudMapNamespace: { name: 'shepherd.local' },
			// containerInsights: true,
		})

		/** create a listener for the alb.
		 * (this should be in /infra, but feat may be removed later anyhow) */


		/** create fargate services required for shepherd */

		/** indexer service. setting `minHealthyPercent` seems to make deployment faster */
		if(config.services.indexer){
			const indexer = createService('indexer', { stack, cluster, logGroup, minHealthyPercent: 0 }, {
				cpu: 256,
				memoryLimitMiB: 512,
			}, {
				DB_HOST: rdsEndpoint,
				SLACK_WEBHOOK: config.slack_webhook!,
				HOST_URL: config.host_url || 'https://arweave.net',
				GQL_URL: config.gql_url || 'https://arweave.net/graphql',
				GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			})
		}

		/* feeder service */
		if(config.services.feeder){
			const feeder = createService('feeder', { stack, cluster, logGroup }, {
				cpu: 1024,
				memoryLimitMiB: 2048,
			}, {
				DB_HOST: rdsEndpoint,
				SLACK_WEBHOOK: config.slack_webhook!,
				AWS_FEEDER_QUEUE: feederQueueUrl,
				AWS_SQS_INPUT_QUEUE: inputQueueUrl,
			})
			feeder.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
				actions: ['sqs:*'],
				resources: [
					`arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:shepherd2-feeder-q`,
					`arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:shepherd2-input-q`,
				],
			}))
		}

		/* fetchers service */
		if(config.services.fetchers){
			const fetchers = createService('fetchers', { stack, cluster, logGroup }, {
				cpu: 1024,
				memoryLimitMiB: 2048,
			}, {
				DB_HOST: rdsEndpoint,
				SLACK_WEBHOOK: config.slack_webhook!,
				STREAMS_PER_FETCHER: '50',
				HOST_URL: config.host_url || 'https://arweave.net',
				AWS_FEEDER_QUEUE: feederQueueUrl,
				AWS_INPUT_BUCKET: inputBucketName,
				AWS_DEFAULT_REGION: cdk.Aws.REGION,
			})
			fetchers.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
				actions: ['sqs:*'],
				resources: [`arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:shepherd2-feeder-q`],
			}))
			fetchers.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
				actions: ['s3:*'],
				resources: [`arn:aws:s3:::${inputBucketName}/*`],
			}))
			fetchers.autoScaleTaskCount({
				minCapacity: 1,
				maxCapacity: 10,
			}).scaleOnCpuUtilization('CpuScaling', {
				targetUtilizationPercent: 60,
				scaleInCooldown: cdk.Duration.seconds(60),
				scaleOutCooldown: cdk.Duration.seconds(60),
			})
		}

		/* http-api service */
		if(config.services.httpApi){
			const httpApi = createService('http-api', { stack, cluster, logGroup }, {
				cpu: 1024,
				memoryLimitMiB: 2048,
			}, {
				DB_HOST: rdsEndpoint,
				SLACK_WEBHOOK: config.slack_webhook!,
				SLACK_POSITIVE: config.slack_positive!,
				HOST_URL: config.host_url || 'https://arweave.net',
			})
			httpApi.connections.securityGroups[0].addIngressRule(
				cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
				cdk.aws_ec2.Port.tcp(84),
				'allow traffic from within the vpc on port 84'
			)
		}

		/* webserver service */
		if(config.services.webserver){
			const webserver = createService('webserver', { stack, cluster, logGroup }, {
				cpu: 2048,
				memoryLimitMiB: 4096,
			}, {
				DB_HOST: rdsEndpoint,
				SLACK_WEBHOOK: config.slack_webhook!,
				SLACK_POSITIVE: config.slack_positive!,
				SLACK_PROBE: config.slack_probe!,
				HOST_URL: config.host_url || 'https://arweave.net',
				GQL_URL: config.gql_url || 'https://arweave.net/graphql',
				GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
				BLACKLIST_ALLOWED: JSON.stringify(config.txids_whitelist) || '',
				RANGELIST_ALLOWED: JSON.stringify(config.ranges_whitelist) || '',
				GW_URLS: JSON.stringify(config.gw_urls) || '',
			})
			webserver.taskDefinition.defaultContainer?.addPortMappings({
				containerPort: 80,
			})
			const listener80 = alb.addListener('port80Listener', {
				protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
				port: 80,
			})
			listener80.addTargets('port80Target', {
				protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
				port: 80,
				targets: [webserver],
			})
			webserver.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
				actions: ['ssm:GetParameter'],
				resources: [`arn:aws:ssm:${cdk.Aws.REGION}:*:parameter/shepherd/*`],
			}))
		}

		/** write parameters to ssm */
		const writeParam = (name: string, value: string) => {
			new cdk.aws_ssm.StringParameter(stack, `param-${name}`, {
				parameterName: `/shepherd/${name}`,
				stringValue: value,
			})
		}
		writeParam('ClusterName', cluster.clusterName)
		writeParam('NamespaceArn', cluster.defaultCloudMapNamespace!.namespaceArn)
		writeParam('NamespaceId', cluster.defaultCloudMapNamespace!.namespaceId)
		// writeParam('Listener80', listener80.listenerArn)
	}
}

interface FargateBuilderProps {
	stack: cdk.Stack
	cluster: cdk.aws_ecs.Cluster
	logGroup: cdk.aws_logs.ILogGroup
	minHealthyPercent?: number
}


interface ServiceResources {
	// this is handy for hovering over the props in vscode
	/** Valid values for cpu and ram units used by the Fargate launch type.
	 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
	 *
	 * 256 (.25 vCPU) - Available memory values: 512 (0.5 GB), 1024 (1 GB), 2048 (2 GB)
	 *
	 * 512 (.5 vCPU) - Available memory values: 1024 (1 GB), 2048 (2 GB), 3072 (3 GB), 4096 (4 GB)
	 *
	 * 1024 (1 vCPU) - Available memory values: 2048 (2 GB), 3072 (3 GB), 4096 (4 GB), 5120 (5 GB), 6144 (6 GB), 7168 (7 GB), 8192 (8 GB)
	 *
	 * 2048 (2 vCPU) - Available memory values: Between 4096 (4 GB) and 16384 (16 GB) in increments of 1024 (1 GB)
	 *
	 * 4096 (4 vCPU) - Available memory values: Between 8192 (8 GB) and 30720 (30 GB) in increments of 1024 (1 GB)
	 *
	 * 8192 (8 vCPU) - Available memory values: Between 16384 (16 GB) and 61440 (60 GB) in increments of 4096 (4 GB)
	 *
	 * 16384 (16 vCPU) - Available memory values: Between 32768 (32 GB) and 122880 (120 GB) in increments of 8192 (8 GB)
	 *
	 * @default cpu 256 && memoryLimitMiB: 512
	 */
	cpu: number
	memoryLimitMiB: number
}
interface Environment {
	[key: string]: string
}
/** create a standard shepherd fargate service */
const createService = (
	name: string,
	{ stack, cluster, logGroup, minHealthyPercent }: FargateBuilderProps,
	{ cpu, memoryLimitMiB }: ServiceResources,
	environment: Environment
) => {
	const Name = name.charAt(0).toUpperCase() + name.slice(1)
	const dockerImage = new cdk.aws_ecr_assets.DockerImageAsset(stack, `image${Name}`, {
		directory: new URL('../', import.meta.url).pathname,
		exclude: ['infra', `cdk.out.${cdk.Aws.REGION}`],
		target: name,
		assetName: `${name}-image`,
		platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
	})
	const tdef = new cdk.aws_ecs.FargateTaskDefinition(stack, `tdef${Name}`, {
		cpu,
		memoryLimitMiB,
		runtimePlatform: { cpuArchitecture: cdk.aws_ecs.CpuArchitecture.X86_64 },
		family: name,
	})
	tdef.addContainer(`container${Name}`, {
		image: cdk.aws_ecs.ContainerImage.fromDockerImageAsset(dockerImage),
		logging: new cdk.aws_ecs.AwsLogDriver({
			logGroup,
			streamPrefix: name,
		}),
		containerName: `${name}Container`,
		environment,
	})
	const fg = new cdk.aws_ecs.FargateService(stack, `fg${Name}`, {
		cluster,
		taskDefinition: tdef,
		serviceName: name,
		cloudMapOptions: { name },
		desiredCount: 1,
		...(minHealthyPercent ? { minHealthyPercent } : {})
	})

	return fg
}
