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
	const stack = new Stack(app, 'IndexerNext', {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		stackName: 'indexer-next',
		description: 'indexer run as a private addon'
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
	// const alb = aws_elasticloadbalancingv2.ApplicationLoadBalancer.fromLookup(stack, 'alb', { loadBalancerArn })
	const listener80 = aws_elasticloadbalancingv2.ApplicationListener.fromLookup(stack, 'listener80', { listenerArn: await readParamSdk('Listener80') })


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
			SLACK_WEBHOOK: config.slack_webhook!
		},
	})

	/** create indexer-next service */
	const service = createAddonService(stack, 'indexer-next', {
		cluster,
		logGroup: logGroupServices,
		cloudMapNamespace,
	}, {
		DB_HOST: rdsEndpoint,
		SLACK_WEBHOOK: config.slack_webhook!,
		GQL_URL: config.gql_url || 'https://arweave.net/graphql',
		GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
		FN_OWNER_BLOCKING: fnOwnerBlocking.functionName,
		LISTS_BUCKET: `shepherd-lists-${config.region}`,
	})
	/* allow service to invoke lambda fnOwnerTable */
	service.taskDefinition.taskRole?.addToPrincipalPolicy(new aws_iam.PolicyStatement({
		actions: ['lambda:InvokeFunction'],
		resources: [fnOwnerBlocking.functionArn],
	}))

	/** create s3 for lists, with lambda connecting alb paths to requests */
	const listsBucket = buildListsBucket(stack, {
		config,
		vpc,
		listener: listener80,
		logGroupServices,
		environment: {
			RANGES_WHITELIST_JSON: JSON.stringify(config.ranges_whitelist),
			TXIDS_WHITELIST_JSON: JSON.stringify(config.txids_whitelist),
		},
	})


}