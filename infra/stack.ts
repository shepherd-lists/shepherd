import { App, Duration, Stack, aws_ec2, aws_ecs, aws_lambda, aws_lambda_nodejs, aws_logs, aws_ssm } from 'aws-cdk-lib'
import { Config } from '../../../Config'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { createAddonService } from './createService'

/** import params */
const readParamSdk = async (name: string) => {
	const ssm = new SSMClient()
	return (await ssm.send(new GetParameterCommand({
		Name: `/shepherd/${name}`,
		WithDecryption: true, // ignored if unencrypted
	}))).Parameter!.Value as string // throw when undefined
}
const vpcName = await readParamSdk('VpcName')


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

	/** create indexer-next service */
	const service = createAddonService('indexer-next', { stack, cluster, logGroup: logGroupServices, config, rdsEndpoint })

	/** create lambda to flag and process an owners txids into byte-ranged */
	const name = 'fnOwnerTable'
	const fnOwnerTable = new aws_lambda_nodejs.NodejsFunction(stack, name, {
		runtime: aws_lambda.Runtime.NODEJS_20_X,
		architecture: aws_lambda.Architecture.X86_64,
		handler: 'handler',
		entry: new URL(`../lambdas/${name}/index.ts`, import.meta.url).pathname,
		bundling: {
			format: aws_lambda_nodejs.OutputFormat.ESM,
			banner: 'import { createRequire } from \'module\';const require = createRequire(import.meta.url);',
		},
		timeout: Duration.minutes(15), //max
		environment: {
			DB_HOST: rdsEndpoint,
			SLACK_WEBHOOK: config.slack_webhook!,
		},
		vpc,
		vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
		securityGroups: [sgPgdb,],
	})
}