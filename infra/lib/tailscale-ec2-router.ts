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
		securityGroup: new aws_ec2.SecurityGroup(stack, 'tsSubRouterSG', {
			vpc,
			allowAllOutbound: true,
			description: 'allow all outbound for tailscale subrouter (cw agent)'
		}),
	})


	instance.addUserData(userData)

}

const userData = `#!/bin/bash
exec > >(tee /var/log/user-data.log) 2>&1
echo "Starting user data script execution"

# Update packages and install necessary dependencies
apt-get update
apt-get install -y unzip

# Download and install the CloudWatch Agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -O /tmp/amazon-cloudwatch-agent.deb
dpkg -i /tmp/amazon-cloudwatch-agent.deb

# CloudWatch Agent configuration
cat <<EOF > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "shepherd-infra-ts",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
EOF

# Start the CloudWatch Agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

`