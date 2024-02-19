import { Stack, aws_ecr_assets, aws_ecs, aws_logs, aws_servicediscovery } from 'aws-cdk-lib'


/** from template for a standard addon service (w/o cloudmap) */
interface FargateBuilderProps {

}
export const createAddonService = (
	stack: Stack,
	name: string,
	config: {
		cluster: aws_ecs.ICluster,
		logGroup: aws_logs.ILogGroup,
		cloudMapNamespace: aws_servicediscovery.IPrivateDnsNamespace,
	},
	environment: Record<string, string> = {},
) => {
	const { cluster, logGroup, cloudMapNamespace } = config
	const Name = name.charAt(0).toUpperCase() + name.slice(1)
	const dockerImage = new aws_ecr_assets.DockerImageAsset(stack, `image${Name}`, {
		directory: new URL(`../services/${name}`, import.meta.url).pathname,
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
		environment,
	})
	const fg = new aws_ecs.FargateService(stack, `fg${Name}`, {
		cluster,
		taskDefinition: tdef,
		serviceName: name,
		cloudMapOptions: {
			name,
			cloudMapNamespace,
		},
		desiredCount: 1,
	})

	return fg
}
