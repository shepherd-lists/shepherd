import { App, Stack, aws_ec2, aws_ecs, aws_logs } from 'aws-cdk-lib'
import { Config } from '../../../Config'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'


export const createStack = async (app: App, config: Config) => {
	const stack = new Stack(app, 'IndexerNext', {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		stackName: 'indexer-next',
		description: 'indexer run as a private addon'
	})

	/** initialise imports */

	/** import params */
	const readParam = async (name: string) => {
		const ssm = new SSMClient()
		return (await ssm.send(new GetParameterCommand({
			Name: `/shepherd/${name}`,
			WithDecryption: true, // ignored if unencrypted
		}))).Parameter!.Value as string // throw when undefined
	}
	const vpcName = await readParam('VpcName')
	const RdsEndpoint = await readParam('RdsEndpoint')
	const logGroupName = await readParam('LogGroup')
	const clusterName = await readParam('ClusterName')

	/** import shepherd infra */
	const vpc = aws_ec2.Vpc.fromLookup(stack, 'shepherd-vpc', { vpcName })
	const logGroup = aws_logs.LogGroup.fromLogGroupName(stack, 'services-logs', logGroupName)
	const cluster = aws_ecs.Cluster.fromClusterAttributes(stack, 'shepherd-cluster', { vpc, clusterName })

	

}