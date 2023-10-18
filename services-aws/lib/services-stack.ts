import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'

/** check our env exist */

const envVarNames = [
	/** from shepherd-infra-stack. created when you run the stack's setup */
	'AWS_VPC_ID',
	'AWS_SECURITY_GROUP_ID', //vpc default sg. this is wrong/not set up correctly
	'DB_HOST',
	'AWS_FEEDER_QUEUE',
	'AWS_INPUT_BUCKET',
	'AWS_SQS_INPUT_QUEUE',
	'LOG_GROUP_ARN',
	'LOG_GROUP_NAME',
	'LB_ARN',
	'LB_DNSNAME',
	'ShepherdPgdbSg',
	'ShepherdAlbSg',
	/** tailscale key */
	'TS_AUTHKEY',
]
envVarNames.map(name => {
	if (!process.env[name]) throw new Error(`${name} not set`)
})

export class ServicesStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props)
		const stack = this

		/** import shepherd-infra-stack items  */

		const vpc = cdk.aws_ec2.Vpc.fromLookup(stack, 'vpc', { vpcId: process.env.AWS_VPC_ID })
		const sgVpcDefault = cdk.aws_ec2.SecurityGroup.fromSecurityGroupId(stack, 'sgVpcDefault', process.env.AWS_SECURITY_GROUP_ID!)
		const sgPgdb = cdk.aws_ec2.SecurityGroup.fromSecurityGroupId(stack, 'sgPgdb', process.env.ShepherdPgdbSg!)
		// const pgdb = cdk.aws_rds.DatabaseInstance.fromDatabaseInstanceAttributes(stack, 'pgdb', {
		// 	instanceEndpointAddress: process.env.DB_HOST!,
		// 	securityGroups: [defaultVpcSg],
		// 	instanceIdentifier: 'shepherd-pgdb',
		// 	port: 5432,
		// })
		const alb = cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer.fromLookup(stack, 'alb', { loadBalancerArn: process.env.LB_ARN })
		const sgAlb = cdk.aws_ec2.SecurityGroup.fromSecurityGroupId(stack, 'sgAlb', process.env.ShepherdAlbSg!)
		const logGroup = cdk.aws_logs.LogGroup.fromLogGroupName(stack, 'logGroup', process.env.LOG_GROUP_NAME!)
		//to be continued...


		/** create a cluster for fargates */

		const cluster = new cdk.aws_ecs.Cluster(stack, 'shepherd-services-cluster', {
			vpc,
			clusterName: 'shepherd-services',
			defaultCloudMapNamespace: { name: 'shepherd.local' },
		})


		/** create fargate services required for shepherd */

		/* tailscale vpn service */
		const tailscale = createTailscale({ stack, cluster, logGroup, vpc })

		/** indexer service. setting `minHealthyPercent` seems to make deployment faster */
		const indexer = createService('indexer', { stack, cluster, logGroup, minHealthyPercent: 0 }, {
			cpu: 4096,
			memoryLimitMiB: 16384,
		}, {
			DB_HOST: process.env.DB_HOST!,
			SLACK_WEBHOOK: process.env.SLACK_WEBHOOK!,
			HOST_URL: process.env.HOST_URL || 'https://arweave.net',
			GQL_URL: process.env.GQL_URL || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: process.env.GQL_URL_SECONDARY || 'https://arweave-search.goldsky.com/graphql',
		})



		/* feeder service */
		const feeder = createService('feeder', { stack, cluster, logGroup }, {
			cpu: 2048,
			memoryLimitMiB: 8192,
		}, {
			DB_HOST: process.env.DB_HOST!,
			SLACK_WEBHOOK: process.env.SLACK_WEBHOOK!,
			AWS_FEEDER_QUEUE: process.env.AWS_FEEDER_QUEUE!,
		})
		feeder.node.addDependency(indexer)
		feeder.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
			actions: ['sqs:*'],
			resources: [`arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:shepherd-feeder-q`],
		}))

		/* fetchers service */
		const fetchers = createService('fetchers', { stack, cluster, logGroup }, {
			cpu: 2048,
			memoryLimitMiB: 8192,
		}, {
			DB_HOST: process.env.DB_HOST!,
			SLACK_WEBHOOK: process.env.SLACK_WEBHOOK!,
			STREAMS_PER_FETCHER: process.env.STREAMS_PER_FETCHER || '50',
			HOST_URL: process.env.HOST_URL || 'https://arweave.net',
			AWS_FEEDER_QUEUE: process.env.AWS_FEEDER_QUEUE!,
			AWS_INPUT_BUCKET: process.env.AWS_INPUT_BUCKET!,
			AWS_DEFAULT_REGION: cdk.Aws.REGION,
		})
		fetchers.node.addDependency(indexer)
		fetchers.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
			actions: ['sqs:*'],
			resources: [`arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:shepherd-feeder-q`],
		}))
		fetchers.taskDefinition.taskRole.addToPrincipalPolicy(new cdk.aws_iam.PolicyStatement({
			actions: ['s3:*'],
			resources: [`arn:aws:s3:::${process.env.AWS_INPUT_BUCKET!}/*`],
		}))
		fetchers.autoScaleTaskCount({
			minCapacity: 1,
			maxCapacity: 10,
		}).scaleOnCpuUtilization('CpuScaling', {
			targetUtilizationPercent: 60,
			scaleInCooldown: cdk.Duration.seconds(60),
			scaleOutCooldown: cdk.Duration.seconds(60),
		})

		/* http-api service */
		const httpApi = createService('http-api', { stack, cluster, logGroup }, {
			cpu: 2048,
			memoryLimitMiB: 4096,
		}, {
			DB_HOST: process.env.DB_HOST!,
			SLACK_WEBHOOK: process.env.SLACK_WEBHOOK!,
			SLACK_POSITIVE: process.env.SLACK_POSITIVE!,
			HOST_URL: process.env.HOST_URL || 'https://arweave.net',
			GQL_URL: process.env.GQL_URL || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: process.env.GQL_URL_SECONDARY || 'https://arweave-search.goldsky.com/graphql',
		})
		httpApi.connections.securityGroups[0].addIngressRule(
			cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
			cdk.aws_ec2.Port.tcp(84),
			'allow traffic from within the vpc on port 84'
		)

		/* webserver service */
		const webserver = createService('webserver', { stack, cluster, logGroup }, {
			cpu: 2048,
			memoryLimitMiB: 8192,
		}, {
			DB_HOST: process.env.DB_HOST!,
			SLACK_WEBHOOK: process.env.SLACK_WEBHOOK!,
			SLACK_POSITIVE: process.env.SLACK_POSITIVE!,
			SLACK_PROBE: process.env.SLACK_PROBE!,
			HOST_URL: process.env.HOST_URL || 'https://arweave.net',
			GQL_URL: process.env.GQL_URL || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: process.env.GQL_URL_SECONDARY || 'https://arweave-search.goldsky.com/graphql',
			BLACKLIST_ALLOWED: process.env.BLACKLIST_ALLOWED || '',
			RANGELIST_ALLOWED: process.env.RANGELIST_ALLOWED || '',
			GW_URLS: process.env.GW_URLS || '',
		})
		webserver.taskDefinition.defaultContainer?.addPortMappings({
			containerPort: 80,
		})
		alb.addListener('port80Listener', {
			protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
			port: 80,
		}).addTargets('port80Target', {
			protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
			port: 80,
			targets: [webserver],
		})


		new cdk.CfnOutput(stack, 'ShepherdCluster', { exportName: 'ShepherdCluster', value: cluster.clusterName })
		new cdk.CfnOutput(stack, 'ShepherdAlbDnsName', { exportName: 'ShepherdAlbDnsName', value: alb.loadBalancerDnsName })
	}
}

interface FargateBuilderProps {
	stack: cdk.Stack
	cluster: cdk.aws_ecs.Cluster
	logGroup: cdk.aws_logs.ILogGroup
	minHealthyPercent?: number
}
interface FargateBuilderVpcProps extends FargateBuilderProps {
	vpc: cdk.aws_ec2.IVpc
}


const createTailscale = ({ stack, cluster, logGroup, vpc }: FargateBuilderVpcProps) => {

	/* N.B. there's no need for any AWS port mapping when using tailscale */

	const tdefTailscale = new cdk.aws_ecs.FargateTaskDefinition(stack, 'tdefTailscale', {
		cpu: 256,
		memoryLimitMiB: 512,
	})
	tdefTailscale.addContainer('tailscaleImage', {
		image: cdk.aws_ecs.ContainerImage.fromRegistry('tailscale/tailscale'),
		logging: new cdk.aws_ecs.AwsLogDriver({
			logGroup,
			streamPrefix: 'tailscale',
		}),
		containerName: 'tailscaleContainer',
		environment: {
			TS_AUTHKEY: process.env.TS_AUTHKEY!,
			TS_ROUTES: vpc.privateSubnets.map(s => s.ipv4CidrBlock).join(','),
			TS_EXPIRY_KEY_DISABLE: 'true',
			TS_ADVERTISE_ROUTES: 'true',
		}
	})
	const fgTailscale = new cdk.aws_ecs.FargateService(stack, 'fgTailscale', {
		cluster,
		taskDefinition: tdefTailscale,
	})

	return fgTailscale
}


interface ServiceResources {
	cpu: number
	memoryLimitMiB: number
}
interface Environment {
	[key: string]: string
}
const createService = (
	name: string,
	{ stack, cluster, logGroup, minHealthyPercent }: FargateBuilderProps,
	{ cpu, memoryLimitMiB }: ServiceResources,
	environment: Environment
) => {
	const Name = name.charAt(0).toUpperCase() + name.slice(1)
	const dockerImage = new cdk.aws_ecr_assets.DockerImageAsset(stack, `image${Name}`, {
		directory: new URL('../../services/', import.meta.url).pathname,
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
