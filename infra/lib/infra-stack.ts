import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** check our env exist */

const envVarNames = [
	'CIDR',
]
envVarNames.map(name => {
	if (!process.env[name]) throw new Error(`${name} not set`)
})



export class InfraStack extends cdk.Stack {
	constructor(app: Construct, id: string, props?: cdk.StackProps) {
		super(app, id, props);
		const stack = this // idc for `this`

		/** create the main network stack */

		const vpc = new cdk.aws_ec2.Vpc(stack, 'shepherd-vpc', {
			vpcName: 'shepherd-vpc',
			maxAzs: 2,
			natGateways: 1,
			/** 
			 * need separate cidr for each vpc / shepherd installation, if we are connecting them via vpn peering / tailnet.
			 * n.b. legacy shepherd uses '10.0.0.0/16', maybe we need peering during cdk migration?
			 */
			ipAddresses: cdk.aws_ec2.IpAddresses.cidr(process.env.CIDR!),
			subnetConfiguration: [
				{
					cidrMask: 24,
					name: 'public',
					subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
				},
				{
					cidrMask: 24,
					name: 'private',
					subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
				},
			],
		})

		// N.B. removing cluster to services stack 


		const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, 'alb', {
			vpc,
			loadBalancerName: 'shepherd-alb',
			internetFacing: true,
			http2Enabled: false,
			dropInvalidHeaderFields: true,
			deletionProtection: true,
			// vpcSubnets: -- defaults to placing ALB in public subnets
		})

		/** general log group for the vpc */
		const logGroup = new cdk.aws_logs.LogGroup(this, 'logGroup', {
			logGroupName: 'shepherd-logs',
			retention: cdk.aws_logs.RetentionDays.THREE_MONTHS,
		})


		/** create the postgres rds database */
		const { sgPgdb, pgdb } = pgdbAndAccess(stack, vpc)

		/** create input bucket, and queues */
		const { inputBucket, sqsInputQ } = bucketAndNotificationQs(stack, vpc)

		/** create feeder Q */
		const { feederQ } = feederQs(stack, vpc)


		/** SQS queue security */

		/* create vpc interface endoint for SQS queues */
		const sqsVpcEndpoint = new cdk.aws_ec2.InterfaceVpcEndpoint(stack, 'sqsVpcEndpoint', {
			vpc,
			service: new cdk.aws_ec2.InterfaceVpcEndpointAwsService('sqs'),
			// subnets: -- defaults to private subnets
			// securityGroups: --- defaults to the vpc default sg
		})

		/* grant vpc resources access to the queues */
		const queues = [sqsInputQ, feederQ]
		queues.map(q => {
			q.addToResourcePolicy(new cdk.aws_iam.PolicyStatement({
				effect: cdk.aws_iam.Effect.ALLOW,
				principals: [new cdk.aws_iam.AccountPrincipal(cdk.Aws.ACCOUNT_ID)],
				actions: ['sqs:*'],
				resources: [q.queueArn],
				conditions: {
					StringEquals: {
						'aws:SourceVpce': sqsVpcEndpoint.vpcEndpointId,
					},
				},
			}))
		})

		/** S3 input bucket security */

		const s3Endpoint = new cdk.aws_ec2.GatewayVpcEndpoint(stack, 's3VpcEndpoint', {
			vpc,
			service: cdk.aws_ec2.GatewayVpcEndpointAwsService.S3,
		})
		inputBucket.addToResourcePolicy(new cdk.aws_iam.PolicyStatement({
			effect: cdk.aws_iam.Effect.ALLOW,
			principals: [new cdk.aws_iam.AnyPrincipal()], //need to be in the vpc though
			actions: ['s3:*'],
			resources: [inputBucket.bucketArn, `${inputBucket.bucketArn}/*`],
			conditions: {
				StringEquals: {
					'aws:SourceVpce': s3Endpoint.vpcEndpointId,
				},
			},
		}))


		/** cfn outputs. CONVERT ALL OF THESE TO PARAMS */

		const cfnOut = (name: string, value: string) => {
			name = name.replace(/[-_.]/g, '')
			new cdk.CfnOutput(stack, name, { exportName: name, value })
		}
		cfnOut('AWS_ACCOUNT_ID', cdk.Aws.ACCOUNT_ID)
		cfnOut('AWS_VPC_ID', vpc.vpcId)
		cfnOut('DB_HOST', pgdb.dbInstanceEndpointAddress)
		cfnOut('AWS_FEEDER_QUEUE', feederQ.queueUrl)
		cfnOut('AWS_INPUT_BUCKET', inputBucket.bucketName)
		cfnOut('AWS_SQS_INPUT_QUEUE', sqsInputQ.queueUrl)
		cfnOut('LOG_GROUP_NAME', logGroup.logGroupName)
		cfnOut('LB_ARN', alb.loadBalancerArn)
		cfnOut('LB_DNSNAME', alb.loadBalancerDnsName)

		/** write parameters to ssm */
		const writeParam = (name: string, value: string) => {
			new cdk.aws_ssm.StringParameter(stack, name, {
				parameterName: `/shepherd/${name}`,
				stringValue: value,
			})
		}
		// writeParam('VpcId', vpc.vpcId) <== can't create a vpc from a token lookup!
		writeParam('VpcSg', vpc.vpcDefaultSecurityGroup)
		writeParam('PgdbSg', sgPgdb.securityGroupId)

	}
}

const pgdbAndAccess = (stack: cdk.Stack, vpc: cdk.aws_ec2.Vpc) => {

	/** create the security group for the postgres rds database */
	const sgPgdb = new cdk.aws_ec2.SecurityGroup(stack, 'shepherd-pgdb-sg', {
		vpc,
		allowAllOutbound: true,
		securityGroupName: 'shepherd-pgdb-sg',
	})
	sgPgdb.addIngressRule(cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock), cdk.aws_ec2.Port.tcp(5432), 'allow db traffic') // allow traffic from within the vpc
	/**
	 * is sgPgdb actually required and/or the ingress rule what we need?
	 */

	/** create the postgres rds database */
	const pgdb = new cdk.aws_rds.DatabaseInstance(stack, 'shepherd-pgdb', {
		vpc,
		instanceIdentifier: 'shepherd-pgdb',
		engine: cdk.aws_rds.DatabaseInstanceEngine.postgres({
			version: cdk.aws_rds.PostgresEngineVersion.VER_13_10,
		}),
		autoMinorVersionUpgrade: true,
		instanceType: new cdk.aws_ec2.InstanceType('t3.xlarge'),
		allocatedStorage: 80,
		storageType: cdk.aws_rds.StorageType.GP2,
		deletionProtection: true,
		removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
		databaseName: 'arblacklist',  //legacy
		credentials: {
			username: 'postgres',
			password: cdk.SecretValue.plainText('postgres'),
		},
		vpcSubnets: {
			subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
		},
		securityGroups: [sgPgdb],
	})

	return {
		sgPgdb,
		pgdb,
	}
}

const bucketAndNotificationQs = (stack: cdk.Stack, vpc: cdk.aws_ec2.Vpc) => {

	/** create AWS_SQS_INPUT_QUEUE, with DLQ and policies */
	const sqsInputQ = new cdk.aws_sqs.Queue(stack, 'shepherd-input-q', {
		queueName: 'shepherd-input-q',
		retentionPeriod: cdk.Duration.days(14),
		visibilityTimeout: cdk.Duration.minutes(15),
		deadLetterQueue: {
			maxReceiveCount: 10,
			queue: new cdk.aws_sqs.Queue(stack, 'shepherd-input-dlq', {
				queueName: 'shepherd-input-dlq',
				retentionPeriod: cdk.Duration.days(14),
			}),
		},
	})

	/** create the input bucket */
	const inputBucket = new cdk.aws_s3.Bucket(stack, 'shepherd-input-s3', {
		accessControl: cdk.aws_s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
		bucketName: `shepherd-input-s3-${cdk.Aws.REGION}`,
		removalPolicy: cdk.RemovalPolicy.DESTROY,
		autoDeleteObjects: true,
	})
	inputBucket.addObjectCreatedNotification(new cdk.aws_s3_notifications.SqsDestination(sqsInputQ))

	return {
		sqsInputQ,
		inputBucket,
	}
}

const feederQs = (stack: cdk.Stack, vpc: cdk.aws_ec2.Vpc) => {
	const feederQ = new cdk.aws_sqs.Queue(stack, 'shepherd-feeder-q', {
		queueName: 'shepherd-feeder-q',
		retentionPeriod: cdk.Duration.days(14), //max value
		visibilityTimeout: cdk.Duration.minutes(15),
		deadLetterQueue: {
			maxReceiveCount: 10,
			queue: new cdk.aws_sqs.Queue(stack, 'shepherd-feeder-dlq', {
				queueName: 'shepherd-feeder-dlq',
				retentionPeriod: cdk.Duration.days(14),
			}),
		},
	})

	return {
		feederQ,
	}
}