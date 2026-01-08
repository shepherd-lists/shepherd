import { App, Aws, Duration, Stack, aws_ec2, aws_ecs, aws_elasticloadbalancingv2, aws_iam, aws_logs, aws_s3, aws_servicediscovery, aws_ssm } from 'aws-cdk-lib'
import { Config, finalQueueName } from '../../../Config'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { createAddonService } from './createService'
import { createFn } from './createFn'



/** import params */
const readParamSdk = async (name: string) => {
	const ssm = new SSMClient()
	try {
		return (await ssm.send(new GetParameterCommand({
			Name: `/shepherd/${name}`,
			WithDecryption: true, // ignored if unencrypted
		}))).Parameter!.Value as string // throw when undefined
	} catch (e) {
		throw new Error(`Failed to read SSM parameter '/shepherd/${name}' from '${await ssm.config.region()}': ${(e as Error).name}:${(e as Error).message}`)
	}
}
const vpcId = await readParamSdk('VpcId')
const loadBalancerArn = await readParamSdk('AlbArn')
const inputBucketName = await readParamSdk('InputBucket')


export const createStack = async (app: App, config: Config) => {
	const stack = new Stack(app, 'Services', {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		stackName: 'shepherd-classifier-services',
		description: 'shepherd classifier services stack'
	})

	/** import shepherd infra */
	const readParamCfn = (paramName: string) => {
		const name = `/shepherd/${paramName}`
		return aws_ssm.StringParameter.fromStringParameterName(stack, name, name).stringValue
	}
	const rdsEndpoint = readParamCfn('RdsEndpoint')
	const vpc = aws_ec2.Vpc.fromLookup(stack, 'shepherd-vpc', { vpcId })
	const sgPgdb = aws_ec2.SecurityGroup.fromSecurityGroupId(stack, 'pgdb-sg', readParamCfn('PgdbSg'))
	const logGroupServices = aws_logs.LogGroup.fromLogGroupName(stack, 'services-logs', readParamCfn('LogGroup'))
	const cluster = aws_ecs.Cluster.fromClusterAttributes(stack, 'shepherd-cluster', { vpc, clusterName: readParamCfn('ClusterName') })
	const namespaceArn = readParamCfn('NamespaceArn')
	const namespaceId = readParamCfn('NamespaceId')
	const alb = aws_elasticloadbalancingv2.ApplicationLoadBalancer.fromLookup(stack, 'alb', { loadBalancerArn })
	/** bucket permissions are granted at the end */
	const listsBucket = aws_s3.Bucket.fromBucketArn(stack, 'listsBucket', readParamCfn('ListsBucketArn'))
	const inputBucket = aws_s3.Bucket.fromBucketName(stack, 'inputBucket', readParamCfn('InputBucket'))

	const cloudMapNamespace = aws_servicediscovery.PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(stack, 'shepherd.local', {
		namespaceName: 'shepherd.local',
		namespaceArn: namespaceArn,
		namespaceId: namespaceId,
	})

	/** create lambda to flag and process an owners txids into byte-ranged */
	const fnOwnerBlocking = createFn('fnOwnerBlocking', stack, {
		vpc,
		securityGroups: [sgPgdb],
		logGroup: logGroupServices,
		memorySize: 350,
		timeout: Duration.minutes(5),
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			HOST_URL: config.host_url || 'https://arweave.net',
			http_api_nodes: JSON.stringify(config.http_api_nodes),
			http_api_nodes_url: config.http_api_nodes_url || '', //byte-ranges
			LISTS_BUCKET: listsBucket.bucketName,
		},
	})
	/** create lambda to process incoming items */
	const fnIndex = createFn('fnIndex', stack, {
		vpc,
		securityGroups: [sgPgdb],
		logGroup: logGroupServices,
		// memorySize: 128,
		// timeout: Duration.minutes(15),
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			HOST_URL: config.host_url || 'https://arweave.net',
			http_api_nodes: JSON.stringify(config.http_api_nodes),
			http_api_nodes_url: config.http_api_nodes_url || '', //byte-ranges
		},
	})
	const fnIngress = createFn('fnIngress', stack, {
		vpc,
		securityGroups: [sgPgdb],
		logGroup: logGroupServices,
		memorySize: 4096,// 2048, //batchSize 50 records, just parallel chunk & s3 buffers 384mb + overhead
		//timeout: Duration.minutes(15), //there is an internal timeout for processRecord
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			HOST_URL: config.host_url || 'https://arweave.net',
			AWS_INPUT_BUCKET: inputBucketName,
			http_api_nodes: JSON.stringify(config.http_api_nodes),
			http_api_nodes_url: config.http_api_nodes_url || '',
			ingress_nodes: JSON.stringify(config.ingress_nodes),
		},
	})
	fnIngress.addToRolePolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [`arn:aws:s3:::${inputBucketName}/*`],
	}))
	/** create lambda to update s3 lists using db */
	const fnInitLists = createFn('fnInitLists', stack, {
		vpc,
		securityGroups: [sgPgdb],
		logGroup: logGroupServices,
		memorySize: 4096, // try boosting this for performance increase
		timeout: Duration.minutes(10), //this is a one-off lambda
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			LISTS_BUCKET: listsBucket.bucketName,
		}
	})
	const fnTemp = createFn('fnTemp', stack, {
		vpc,
		securityGroups: [sgPgdb],
		logGroup: logGroupServices,
		memorySize: 3072, // might need to increase again, already using 2.5gb
		timeout: Duration.minutes(10),
		reservedConcurrentExecutions: 1,
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			LISTS_BUCKET: listsBucket.bucketName,
		}
	})


	/** create indexer-next service */
	const indexerNext = createAddonService(stack, 'indexer-next', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
		resources: {
			cpu: 256,
			memoryLimitMiB: 512,
		},
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			HOST_URL: config.host_url || 'https://arweave.net',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			FN_OWNER_BLOCKING: fnOwnerBlocking.functionName,
			FN_TEMP: fnTemp.functionName,
			FN_INIT_LISTS: fnInitLists.functionName,
			LISTS_BUCKET: listsBucket.bucketName,
			FN_INGRESS: fnIngress.functionName,
		}
	})
	/* allow indexerNext to invoke various lambdas */
	const taskroleIndex = indexerNext.taskDefinition.taskRole
	taskroleIndex.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['lambda:InvokeFunction'],
		resources: [
			fnOwnerBlocking.functionArn,
			fnIngress.functionArn,
			fnInitLists.functionArn,
			fnTemp.functionArn,
		],
	}))
	taskroleIndex.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [listsBucket.bucketArn + '/*'],
	}))
	taskroleIndex.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['ssm:GetParameter', 'ssm:PutParameter'],
		resources: [`arn:aws:ssm:${config.region}:*:parameter/shepherd/*`],
	}))

	const webserver = createAddonService(stack, 'webserver-next', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
		resources: {
			cpu: 512,
			memoryLimitMiB: 3072,
		},
		/* quicker dev deployments */
		...(config.region !== 'ap-southeast-1' && {
			minHealthyPercent: 100,
			maxHealthyPercent: 200,
		}),
		environment: {
			LISTS_BUCKET: listsBucket.bucketName,
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			SLACK_PROBE: config.slack_probe!,
			HOST_URL: config.host_url || 'https://arweave.net',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			BLACKLIST_ALLOWED: JSON.stringify(config.txids_whitelist) || '',
			RANGELIST_ALLOWED: JSON.stringify(config.ranges_whitelist) || '',
			http_api_nodes: JSON.stringify(config.http_api_nodes), //used in byte-ranges only
			http_api_nodes_url: config.http_api_nodes_url || '', //byte-ranges and allowed list
		}
	})
	webserver.taskDefinition.defaultContainer!.addPortMappings({ containerPort: 80 })
	const listener80 = alb.addListener('listener80', { port: 80 })
	listener80.addTargets('web-next-target', {
		port: 80,
		protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
		targets: [webserver],
		healthCheck: {
			path: '/health-check',
			protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
			port: '80',
			// interval: Duration.seconds(30), default
			// timeout: Duration.seconds(10), default
			healthyThresholdCount: 2, //default 5, min 2
			unhealthyThresholdCount: 4, //default 2
		},
	})
	const taskRoleWeb = webserver.taskDefinition.taskRole!
	taskRoleWeb.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [
			listsBucket.bucketArn + '/*',
			listsBucket.bucketArn,
		],
	}))
	taskRoleWeb.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['ssm:GetParameter'],
		resources: [`arn:aws:ssm:${config.region}:*:parameter/shepherd/*`],
	}))

	if (config.services.checks) {
		const checks = createAddonService(stack, 'checks', {
			cluster,
			logGroup: logGroupServices,
			cloudMapNamespace,
			resources: {
				cpu: 2048,
				memoryLimitMiB: 4096,
			},
			environment: {
				LISTS_BUCKET: listsBucket.bucketName,
				SLACK_WEBHOOK: config.slack_webhook!,
				SLACK_PROBE: config.slack_probe!,
				BLACKLIST_ALLOWED: JSON.stringify(config.txids_whitelist) || '',
				RANGELIST_ALLOWED: JSON.stringify(config.ranges_whitelist) || '',
				GW_DOMAINS: JSON.stringify(config.gw_domains) || '',
				http_api_nodes_url: config.http_api_nodes_url || '',
				DB_HOST: rdsEndpoint, //to detect addons
			}
		})
		const taskRoleChecks = checks.taskDefinition.taskRole!
		taskRoleChecks.addToPrincipalPolicy(new aws_iam.PolicyStatement({
			actions: ['s3:*'],
			resources: [
				listsBucket.bucketArn + '/*',
				listsBucket.bucketArn,
			],
		}))
		taskRoleChecks.addToPrincipalPolicy(new aws_iam.PolicyStatement({
			actions: ['ssm:GetParameter'],
			resources: [`arn:aws:ssm:${config.region}:*:parameter/shepherd/*`],
		}))
	}

	const httpApi = createAddonService(stack, 'http-api', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
		resources: {
			cpu: 1024,
			memoryLimitMiB: 2048,
		},
		environment: {
			LISTS_BUCKET: listsBucket.bucketName,
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			SLACK_POSITIVE: config.slack_positive!,
			HOST_URL: config.host_url || 'https://arweave.net',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			FN_OWNER_BLOCKING: fnOwnerBlocking.functionName,
			http_api_nodes: JSON.stringify(config.http_api_nodes), //for byte-ranges only
			http_api_nodes_url: config.http_api_nodes_url || '', //for byte-ranges only
			FN_TEMP: fnTemp.functionName,
			AWS_INPUT_BUCKET: inputBucketName,
			AWS_SQS_SINK_QUEUE: `https://sqs.${Aws.REGION}.amazonaws.com/${Aws.ACCOUNT_ID}/${finalQueueName(config)}`,
		}
	})
	httpApi.connections.securityGroups[0].addIngressRule(
		aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
		aws_ec2.Port.tcp(84),
		'allow traffic within vpc to port 84',
	)
	const taskRoleHttpApi = httpApi.taskDefinition.taskRole!
	taskRoleHttpApi.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['lambda:InvokeFunction'],
		resources: [
			fnOwnerBlocking.functionArn,
			fnInitLists.functionArn,
			fnTemp.functionArn,
		],
	}))
	taskRoleHttpApi.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['ssm:GetParameter', 'ssm:PutParameter'],
		resources: [`arn:aws:ssm:${config.region}:*:parameter/shepherd/*`],
	}))
	taskRoleHttpApi.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['sqs:*'],
		resources: [
			`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:${finalQueueName(config)}`,
		],
	}))


	/** give various services listsBucket access */
	listsBucket.grantReadWrite(taskroleIndex)
	listsBucket.grantReadWrite(taskRoleWeb)
	listsBucket.grantReadWrite(taskRoleHttpApi)
	listsBucket.grantReadWrite(fnInitLists.role!)
	listsBucket.grantReadWrite(fnOwnerBlocking.role!)
	listsBucket.grantReadWrite(fnTemp.role!)
	listsBucket.grantReadWrite(taskRoleHttpApi)

	/** give http-api access to input bucket */
	inputBucket.grantReadWrite(taskRoleHttpApi)
}
