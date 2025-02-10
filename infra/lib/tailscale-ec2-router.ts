import { Aws, Stack, aws_cloudwatch, aws_ec2, aws_iam, aws_logs } from 'aws-cdk-lib'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'


const globalParam = async (name: string, ssm: SSMClient) => (await ssm.send(new GetParameterCommand({
	Name: `/shepherd/${name}`,
	WithDecryption: true, // ignored if unencrypted
}))).Parameter!.Value as string // throws if undefined

let TS_AUTHKEY: string
const region = await (new SSMClient({})).config.region()
if(region == 'ap-southeast-1'){
	console.info('INFO: using dev authkey for tailscale')
	TS_AUTHKEY = await globalParam('TS_AUTHKEY', new SSMClient({ region: 'ap-southeast-1' })) //THIS IS FOR DEV ONLY.
}else{
	console.info('INFO: using prod authkey for tailscale')
	TS_AUTHKEY = await globalParam('TS_AUTHKEY', new SSMClient({ region: 'eu-west-2' }))
}


export const createTailscaleSubrouter = (stack: Stack, vpc: aws_ec2.Vpc) => {

	/** make a separate log group for this subrouter */
	const logGroup = new aws_logs.LogGroup(stack, 'tsLogGroup', {
		logGroupName: 'shepherd-infra-ts',
		retention: aws_logs.RetentionDays.ONE_MONTH,
	})

	/** permissions */
	const role = new aws_iam.Role(stack, 'tsSubrouterRole', {
		assumedBy: new aws_iam.ServicePrincipal('ec2.amazonaws.com'),
	})
	role.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'))
	role.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))

	const securityGroup = new aws_ec2.SecurityGroup(stack, 'tsSubrouterSg', {
		vpc,
		allowAllOutbound: true,
		securityGroupName: 'ts-subrouter-sg',
	})
	securityGroup.addIngressRule(aws_ec2.Peer.ipv4(vpc.vpcCidrBlock), aws_ec2.Port.allTraffic(), 'allow traffic from within the vpc')

	/** instance */
	const instance = new aws_ec2.Instance(stack, 'tsSubRouterInstance9', {
		vpc,
		role,
		instanceType: new aws_ec2.InstanceType('t3a.nano'), // t3a.nano is cheapest
		machineImage: aws_ec2.MachineImage.genericLinux({
			/** ubuntu 22.04 LTS amd64. TODO: add more regions. https://cloud-images.ubuntu.com/locator/ec2/ */
			'eu-west-1': 'ami-0932dacac40965a65',
			'eu-west-2': 'ami-07d20571c32ba6cdc',
			'ap-southeast-1': 'ami-0497a974f8d5dcef8',
			'eu-central-1': 'ami-07652eda1fbad7432',
		}),
		securityGroup,
		vpcSubnets: {
			subnetType: aws_ec2.SubnetType.PUBLIC,
		},
	})

	instance.addUserData(userData(logGroup.logGroupName, vpc.privateSubnets.map(s => s.ipv4CidrBlock).join(',')))

	/** recover when unreachable */
	const alarm = new aws_cloudwatch.Alarm(stack, 'tsSubrouterReachablityAlarm', {
		alarmName: 'ts-subrouter-reachable-alarm',
		alarmDescription: 'recover when unreachable',
		metric: new aws_cloudwatch.Metric({
			namespace: 'AWS/EC2',
			metricName: 'StatusCheckFailed_System',
			dimensionsMap: {
				InstanceId: instance.instanceId,
			},
		}),
		threshold: 1,
		evaluationPeriods: 2,
		comparisonOperator: aws_cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		// treatMissingData: aws_cloudwatch.TreatMissingData.BREACHING // seems to be causing problems with new instances.
	})
	alarm.addAlarmAction({
		bind: () => ({
			alarmActionArn: `arn:aws:automate:${Aws.REGION}:ec2:recover`,
		})
	})

}

const userData = (logGroupName: string, subnets: string) => `#!/bin/bash
# starts a new shell and logs this script to /var/log/user-data.log
exec > >(tee /var/log/user-data.log) 2>&1

echo "Starting user data script execution"

echo "# Update packages and install necessary dependencies"
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
apt-get update
apt-get install -y unzip tailscale
apt-get remove -y --purge openssh-server


echo "# Download and install the CloudWatch Agent"
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -O /tmp/amazon-cloudwatch-agent.deb
dpkg -i /tmp/amazon-cloudwatch-agent.deb

echo "# CloudWatch Agent configuration"
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

echo "# Start the CloudWatch Agent"
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

echo "# Configure, then start the tailscale subrouter"
echo "## enable ip forwarding"
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf

echo "## recommended tailscale enhancement"
printf '#!/bin/sh\n\nethtool -K %s rx-udp-gro-forwarding on rx-gro-list off \n' "$(ip route show 0/0 | cut -f5 -d" ")" | sudo tee /etc/networkd-dispatcher/routable.d/50-tailscale
sudo chmod 755 /etc/networkd-dispatcher/routable.d/50-tailscale
sudo /etc/networkd-dispatcher/routable.d/50-tailscale
test $? -eq 0 || echo 'An error occurred in tailscale enhancement.'

echo "# Create a service file for Tailscale"
cat <<EOF > /etc/systemd/system/tailscale.service
[Unit]
Description=Tailscale Node
After=network.target

[Service]
ExecStart=/usr/sbin/tailscaled
ExecStartPost=/usr/bin/tailscale up --authkey=${TS_AUTHKEY} --advertise-routes=${subnets} --hostname=${Aws.REGION}.subnet-router.local
StandardOutput=append:/var/log/user-data.log
StandardError=inherit

[Install]
WantedBy=multi-user.target
EOF


echo "# Reload the systemd daemon and start Tailscale service"
systemctl daemon-reload
systemctl enable tailscale
systemctl start tailscale

`
