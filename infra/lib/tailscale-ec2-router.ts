import { Aws, Stack, aws_ec2, aws_iam, aws_logs } from 'aws-cdk-lib'
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

	/** make a separate log group for this subrouter */
	const logGroup = new aws_logs.LogGroup(stack, 'tsLogGroup', {
		logGroupName: 'shepherd2-infra-ts',
		retention: aws_logs.RetentionDays.ONE_MONTH,
	})

	/** permissions */
	const role = new aws_iam.Role(stack, 'tsSubrouterRole', {
		assumedBy: new aws_iam.ServicePrincipal('ec2.amazonaws.com'),
	})
	role.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'))
	role.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))

	/** instance */
	const instance = new aws_ec2.Instance(stack, "tsSubRouterInstance", {
		vpc,
		role,
		instanceType: new aws_ec2.InstanceType('t3a.nano'), // t3a.nano is cheapest
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

	instance.addUserData(userData(logGroup.logGroupName, vpc.privateSubnets.map(s => s.ipv4CidrBlock).join(',')))

}

const userData = (logGroupName: string, subnets: string) => `#!/bin/bash
exec > >(tee /var/log/user-data.log) 2>&1
echo "Starting user data script execution"

# Update packages and install necessary dependencies
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
apt-get update
apt-get install -y unzip tailscale

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
            "log_group_name": "${logGroupName}",
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

# Start the tailscale subrouter
## enable ip forwarding
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf

## recommended tailscale enhancement
printf '#!/bin/sh\n\nethtool -K %s rx-udp-gro-forwarding on rx-gro-list off \n' "$(ip route show 0/0 | cut -f5 -d" ")" | sudo tee /etc/networkd-dispatcher/routable.d/50-tailscale
sudo chmod 755 /etc/networkd-dispatcher/routable.d/50-tailscale
sudo /etc/networkd-dispatcher/routable.d/50-tailscale
test $? -eq 0 || echo 'An error occurred in tailscale enhancement.'


## start the subrouter
tailscale up --authkey=${TS_AUTHKEY} --advertise-routes=${subnets} --hostname=${Aws.REGION}.subnet-router.local 

`
