import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'

/** check our env exist */

const envVarNames = [
	/** from shepherd-infra-stack */
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

		const cluster = new cdk.aws_ecs.Cluster(stack, 'shepherd-services-cluster', { vpc, clusterName: 'shepherd-services' })

		/** create a test fargate service */

		const fgNginx = fargateNginx({ stack, cluster, logGroup, vpc, alb, sgAlb, port: 80 })

		const tailscale = createTailscale({ stack, cluster, logGroup, vpc, alb, sgAlb, port: 443 })



		new cdk.CfnOutput(stack, 'ShepherdCluster', { exportName: 'ShepherdCluster', value: cluster.clusterName })
		new cdk.CfnOutput(stack, 'ShepherdAlbDnsName', { exportName: 'ShepherdAlbDnsName', value: alb.loadBalancerDnsName })
	}
}

interface FargateBuilderProps {
	stack: cdk.Stack
	cluster: cdk.aws_ecs.Cluster
	logGroup: cdk.aws_logs.ILogGroup
}
interface FargateBuilderIngressProps extends FargateBuilderProps {
	vpc: cdk.aws_ec2.IVpc
	alb: cdk.aws_elasticloadbalancingv2.IApplicationLoadBalancer
	sgAlb: cdk.aws_ec2.ISecurityGroup
	port: number
}

const fargateNginx = ({ stack, cluster, logGroup, vpc, alb, port, sgAlb }: FargateBuilderIngressProps) => {

	/** create tdef, image, service */

	const taskDefinition = new cdk.aws_ecs.FargateTaskDefinition(stack, 'tdefNginx', {
		cpu: 512,
		memoryLimitMiB: 1024,
	})
	taskDefinition.addContainer('nginxImage', {
		image: cdk.aws_ecs.ContainerImage.fromRegistry('nginx:latest'),
		portMappings: [{ containerPort: port }],
		logging: new cdk.aws_ecs.AwsLogDriver({
			logGroup,
			streamPrefix: 'nginx',
		}),
	})
	const fgNginx = new cdk.aws_ecs.FargateService(stack, 'fgNginx', {
		cluster,
		taskDefinition,
		// securityGroups: [sgNginx]
	})

	/** add port mapping */

	alb.addListener('fargateFromWebListener', {
		protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
		port,
	}).addTargets('fargateFromWebTarget', {
		protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
		port,
		targets: [fgNginx],
	})

	return fgNginx
}

const createTailscale = ({ stack, cluster, logGroup, vpc, alb, sgAlb, port }: FargateBuilderIngressProps) => {

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
