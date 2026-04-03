import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { Aws, aws_ec2, aws_ecs, aws_logs, Stack } from 'aws-cdk-lib'


const globalParam = async (name: string, ssm: SSMClient) => (await ssm.send(new GetParameterCommand({
	Name: `/shepherd/${name}`,
	WithDecryption: true, // ignored if unencrypted
}))).Parameter!.Value as string // throws if undefined

console.info('INFO: using prod authkey for tailscale')
const TS_AUTHKEY = await globalParam('TS_AUTHKEY', new SSMClient({ region: 'eu-west-2' }))

export const createTailscaleSubrouter = (stack: Stack, vpc: aws_ec2.Vpc, cluster: aws_ecs.ICluster) => {

	/** make a separate log group for this subrouter */
	const logGroup = new aws_logs.LogGroup(stack, 'tsLogGroup', {
		logGroupName: 'shepherd-infra-ts',
		retention: aws_logs.RetentionDays.ONE_MONTH,
	})


	const tdef = new aws_ecs.FargateTaskDefinition(stack, 'tdefTsSubrouter', {
		cpu: 256,
		memoryLimitMiB: 512,
	})

	tdef.addContainer('containerTsSubrouter', {
		image: aws_ecs.ContainerImage.fromRegistry('tailscale/tailscale:stable'),
		logging: new aws_ecs.AwsLogDriver({ logGroup, streamPrefix: 'tsSubrouter' }),
		containerName: 'tsSubrouterContainer',
		environment: {
			TS_AUTHKEY,
			TS_ROUTES: vpc.privateSubnets.map(s => s.ipv4CidrBlock).join(','),
			TS_EXPIRY_KEY_DISABLE: 'true',
			TS_ADVERTISE_ROUTES: 'true',
			TS_HOSTNAME: `${Aws.REGION}.subnet-router.local`
		},
	})

	return new aws_ecs.FargateService(stack, 'fgTsSubrouter', {
		cluster,
		taskDefinition: tdef,
		serviceName: 'tsSubrouter',
		cloudMapOptions: {
			name: 'tsSubrouter',
			cloudMapNamespace: cluster.defaultCloudMapNamespace,
		},
		desiredCount: 1,
	})
}

