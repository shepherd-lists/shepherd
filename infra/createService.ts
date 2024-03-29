import { IgnoreMode, Stack, aws_ecr_assets, aws_ecs, aws_logs, aws_servicediscovery } from 'aws-cdk-lib'
import { readdirSync } from 'fs'


/** from template for a standard addon service (w/o cloudmap) */

interface ServiceResources {
	// this is handy for hovering over the props in vscode
	/** Valid values for cpu and ram units used by the Fargate launch type.
	 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
	 *
	 * 256 (.25 vCPU) - Available memory values: 512 (0.5 GB), 1024 (1 GB), 2048 (2 GB)
	 *
	 * 512 (.5 vCPU) - Available memory values: 1024 (1 GB), 2048 (2 GB), 3072 (3 GB), 4096 (4 GB)
	 *
	 * 1024 (1 vCPU) - Available memory values: 2048 (2 GB), 3072 (3 GB), 4096 (4 GB), 5120 (5 GB), 6144 (6 GB), 7168 (7 GB), 8192 (8 GB)
	 *
	 * 2048 (2 vCPU) - Available memory values: Between 4096 (4 GB) and 16384 (16 GB) in increments of 1024 (1 GB)
	 *
	 * 4096 (4 vCPU) - Available memory values: Between 8192 (8 GB) and 30720 (30 GB) in increments of 1024 (1 GB)
	 *
	 * 8192 (8 vCPU) - Available memory values: Between 16384 (16 GB) and 61440 (60 GB) in increments of 4096 (4 GB)
	 *
	 * 16384 (16 vCPU) - Available memory values: Between 32768 (32 GB) and 122880 (120 GB) in increments of 8192 (8 GB)
	 *
	 * @default cpu 256 && memoryLimitMiB: 512
	 */
	cpu: number
	memoryLimitMiB: number
}


export const createAddonService = (
	stack: Stack,
	name: string,
	init: {
		cluster: aws_ecs.ICluster,
		logGroup: aws_logs.ILogGroup,
		cloudMapNamespace: aws_servicediscovery.IPrivateDnsNamespace,
		resources: ServiceResources,
		environment: Record<string, string>,
	},
) => {
	const { cluster, logGroup, cloudMapNamespace, resources: { cpu, memoryLimitMiB }, environment } = init
	const Name = name.charAt(0).toUpperCase() + name.slice(1)

	let serviceDirs = readdirSync(new URL(`../services/`, import.meta.url).pathname)
	serviceDirs = serviceDirs.filter((dir) => dir !== name)

	console.debug({ name, serviceDirs }, ['cdk.out*', 'node_modules', 'tests', 'infra', ...serviceDirs])

	const dockerImage = new aws_ecr_assets.DockerImageAsset(stack, `image${Name}`, {
		directory: new URL(`../`, import.meta.url).pathname,
		exclude: ['cdk.out*', 'node_modules', 'tests', 'infra', ...serviceDirs],
		ignoreMode: IgnoreMode.DOCKER,
		target: name,
		buildArgs: { targetArg: name },
		assetName: `${name}-image`,
		platform: aws_ecr_assets.Platform.LINUX_AMD64,
		// cacheDisabled: true,
	})
	const tdef = new aws_ecs.FargateTaskDefinition(stack, `tdef${Name}`, {
		cpu,
		memoryLimitMiB,
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
