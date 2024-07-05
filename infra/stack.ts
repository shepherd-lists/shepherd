import { App, Stack, aws_ec2, aws_ecs, aws_elasticloadbalancingv2, aws_elasticloadbalancingv2_targets, aws_iam, aws_logs, aws_servicediscovery, aws_ssm } from 'aws-cdk-lib'
import { Config } from '../../../Config'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { createAddonService } from './createService'
import { createFn } from './createFn'
import { buildListsBucket } from './listsBucket'



/** import params */
const readParamSdk = async (name: string) => {
	const ssm = new SSMClient()
	return (await ssm.send(new GetParameterCommand({
		Name: `/shepherd/${name}`,
		WithDecryption: true, // ignored if unencrypted
	}))).Parameter!.Value as string // throw when undefined
}
const vpcName = await readParamSdk('VpcName')
const loadBalancerArn = await readParamSdk('AlbArn')


export const createStack = async (app: App, config: Config) => {
	const stack = new Stack(app, 'Next', {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		stackName: 'shepherd-next',
		description: 'shepherd run as a private addon'
	})

	/** import shepherd infra */
	const readParamCfn = (paramName: string) => {
		const name = `/shepherd/${paramName}`
		return aws_ssm.StringParameter.fromStringParameterName(stack, name, name).stringValue
	}
	const rdsEndpoint = readParamCfn('RdsEndpoint')
	const vpc = aws_ec2.Vpc.fromLookup(stack, 'shepherd-vpc', { vpcName })
	const sgPgdb = aws_ec2.SecurityGroup.fromSecurityGroupId(stack, 'pgdb-sg', readParamCfn('PgdbSg'))
	const logGroupServices = aws_logs.LogGroup.fromLogGroupName(stack, 'services-logs', readParamCfn('LogGroup'))
	const cluster = aws_ecs.Cluster.fromClusterAttributes(stack, 'shepherd-cluster', { vpc, clusterName: readParamCfn('ClusterName') })
	const namespaceArn = readParamCfn('NamespaceArn')
	const namespaceId = readParamCfn('NamespaceId')
	const alb = aws_elasticloadbalancingv2.ApplicationLoadBalancer.fromLookup(stack, 'alb', { loadBalancerArn })
	// const listener80 = aws_elasticloadbalancingv2.ApplicationListener.fromLookup(stack, 'listener80', { listenerArn: await readParamSdk('Listener80') })


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
		memorySize: 256,
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			HOST_URL: config.host_url || 'https://arweave.net',
		},
	})

	/** create s3 for lists */
	const listsBucket = buildListsBucket(stack, {
		config,
		//this following below is not used
		vpc,
		listener: null as any,
		logGroupServices,
		environment: {
			RANGES_WHITELIST_JSON: JSON.stringify(config.ranges_whitelist),
			TXIDS_WHITELIST_JSON: JSON.stringify(config.txids_whitelist),
		},
	})

	/** create indexer-next service */
	const indexerNext = createAddonService(stack, 'indexer-next', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
		resources: {
			cpu: 256,
			memoryLimitMiB: 2048,
		},
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			HOST_URL: config.host_url || 'https://arweave.net',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			FN_OWNER_BLOCKING: fnOwnerBlocking.functionName,
			LISTS_BUCKET: `shepherd-lists-${config.region}`,
		}
	})
	/* allow indexerNext to invoke lambda fnOwnerTable */
	const taskroleIndex = indexerNext.taskDefinition.taskRole
	taskroleIndex.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['lambda:InvokeFunction'],
		resources: [fnOwnerBlocking.functionArn],
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
			cpu: 256,
			memoryLimitMiB: 1024,
		},
		environment: {
			LISTS_BUCKET: `shepherd-lists-${config.region}`,
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
		}
	})
	webserver.taskDefinition.defaultContainer!.addPortMappings({ containerPort: 80 })
	const listener80 = alb.addListener('listener80', { port: 80 })
	listener80.addTargets('web-next-target', {
		port: 80,
		protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
		targets: [webserver],
	})
	const taskRoleWeb = webserver.taskDefinition.taskRole!
	taskRoleWeb.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [listsBucket.bucketArn + '/*'],
	}))
	taskRoleWeb.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['ssm:GetParameter'],
		resources: [`arn:aws:ssm:${config.region}:*:parameter/shepherd/*`],
	}))

	const checks = createAddonService(stack, 'checks', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
		resources: {
			cpu: 2048,
			memoryLimitMiB: 4096,
		},
		environment: {
			LISTS_BUCKET: `shepherd-lists-${config.region}`,
			SLACK_WEBHOOK: config.slack_webhook!,
			SLACK_POSITIVE: config.slack_positive!,
			SLACK_PROBE: config.slack_probe!,
			BLACKLIST_ALLOWED: JSON.stringify(config.txids_whitelist) || '',
			RANGELIST_ALLOWED: JSON.stringify(config.ranges_whitelist) || '',
			GW_URLS: JSON.stringify(config.gw_urls) || '',
		}
	})
	const taskRoleChecks = checks.taskDefinition.taskRole!
	taskRoleChecks.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [listsBucket.bucketArn + '/*'],
	}))

	const httpApi = createAddonService(stack, 'http-api', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
		resources: {
			cpu: 1024,
			memoryLimitMiB: 2048,
		},
		environment: {
			LISTS_BUCKET: `shepherd-lists-${config.region}`,
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
			SLACK_POSITIVE: config.slack_positive!,
			HOST_URL: config.host_url || 'https://arweave.net',
			GQL_URL: config.gql_url || 'https://arweave.net/graphql',
			GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			FN_OWNER_BLOCKING: fnOwnerBlocking.functionName,
		}
	})
	httpApi.connections.securityGroups[0].addIngressRule(
		aws_ec2.Peer.ipv4(vpc.vpcCidrBlock),
		aws_ec2.Port.tcp(84),
		'allow traffic within vpc to port 84',
	)
	const taskRoleHttpApi = httpApi.taskDefinition.taskRole!
	taskRoleHttpApi.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['s3:*'],
		resources: [listsBucket.bucketArn + '/*'],
	}))
	taskRoleHttpApi.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['lambda:InvokeFunction'],
		resources: [fnOwnerBlocking.functionArn],
	}))
	taskRoleHttpApi.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['ssm:GetParameter', 'ssm:PutParameter'],
		resources: [`arn:aws:ssm:${config.region}:*:parameter/shepherd/*`],
	}))



	/** give both services listsBucket access */
	listsBucket.grantReadWrite(taskroleIndex)
	listsBucket.grantReadWrite(taskRoleWeb)
	listsBucket.grantReadWrite(taskRoleHttpApi)

}