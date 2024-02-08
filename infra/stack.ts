import { App, Stack, aws_ec2, aws_ecr_assets, aws_ecs, aws_logs } from 'aws-cdk-lib'
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

	/** create indexer-next service */

	/** template for a standard addon service (w/o cloudmap) */
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
			directory: new URL('..', import.meta.url).pathname, //parent folder
			exclude: ['cdk.out*', 'node_modules', 'test', 'infra'],
			target: name,
			assetName: `${name}-image`,
			platform: aws_ecr_assets.Platform.LINUX_AMD64,
		})
		const tdef = new aws_ecs.FargateTaskDefinition(stack, `tdef${Name}`, {
			cpu: 256,
			memoryLimitMiB: 512,
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
				DB_HOST: RdsEndpoint,
				SLACK_WEBHOOK: config.slack_webhook!,
				GQL_URL: config.gql_url || 'https://arweave.net/graphql',
				GQL_URL_SECONDARY: config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql',
			},
		})
		const fg = new aws_ecs.FargateService(stack, `fg${Name}`, {
			cluster,
			taskDefinition: tdef,
			serviceName: name,
			// cloudMapOptions: {
			// 	name,
			// 	cloudMapNamespace,
			// },
			desiredCount: 1,
		})

		return fg
	}

	const service = createAddonService('indexer-next', { stack, cluster, logGroup })

}