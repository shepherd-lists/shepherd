import { Aws, Stack, aws_ec2, aws_iam } from 'aws-cdk-lib'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'


const remoteParam = async (name: string, ssm: SSMClient) => (await ssm.send(new GetParameterCommand({
	Name: `/shepherd/${name}`,
	WithDecryption: true, // ignored if unencrypted
}))).Parameter!.Value as string // throws if undefined
/***
 * THIS IS FOR DEV ONLY. DON'T FORGET TO UPDATE THE REGION.
 */
const TS_AUTHKEY = await remoteParam('TS_AUTHKEY', new SSMClient({ region: 'ap-southeast-1' }))



export const createTailscaleSubrouter = (stack: Stack, vpc: aws_ec2.Vpc) => {

	/** permissions */
	const role = new aws_iam.Role(stack, 'tailscaleSubrouterRole', {
		assumedBy: new aws_iam.ServicePrincipal('ec2.amazonaws.com'),
	})
	role.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'))
	role.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))

	/** instance */
	const instance = new aws_ec2.Instance(stack, "tailscaleSubrouter", {
		vpc,
		role,
		instanceType: new aws_ec2.InstanceType('t3.micro'), // t3a.nano is cheapest
		machineImage: aws_ec2.MachineImage.genericLinux({
			/** ubuntu 22.04 LTS amd64 */
			'eu-west-2': 'ami-0505148b3591e4c07',
			'ap-southeast-1': 'ami-078c1149d8ad719a7',
			'eu-central-1': 'ami-06dd92ecc74fdfb36',
		}),
		securityGroup: aws_ec2.SecurityGroup.fromSecurityGroupId(stack, 'vpcDefaultSG', vpc.vpcDefaultSecurityGroup),
	})



}
