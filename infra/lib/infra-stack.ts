import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfraStack extends cdk.Stack {
  constructor(app: Construct, id: string, props?: cdk.StackProps) {
    super(app, id, props);
    const stack = this // idc for `this`

    /** create the main network stack */

    const vpc = new cdk.aws_ec2.Vpc(stack, 'shepherd-vpc', {
      vpcName: 'shepherd-vpc',
      maxAzs: 2,
      natGateways: 1,
      cidr: '10.1.0.0/16', //legacy shepherd uses '10.0.0.0/16', maybe we need peering during cdk migration?
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    })
    const cluster = new cdk.aws_ecs.Cluster(stack, 'shepherd-cluster', {
      vpc,
      clusterName: 'shepherd-cluster',
    })


    /** create the postgres rds database */
    const { sgPgdb, pgdb } = pgdbAndAccess(stack, vpc)


  }
}

const pgdbAndAccess = (stack: cdk.Stack, vpc: cdk.aws_ec2.Vpc) => {

  /** create the security group for the postgres rds database */
  const sgPgdb = new cdk.aws_ec2.SecurityGroup(stack, 'shepherd-pgdb-sg', {
    vpc,
    allowAllOutbound: true,
    securityGroupName: 'shepherd-pgdb-sg',
  })
  sgPgdb.addIngressRule(cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock), cdk.aws_ec2.Port.tcp(5432), 'allow db traffic') // allow traffic from within the vpc
  sgPgdb.addIngressRule(cdk.aws_ec2.Peer.anyIpv4(), cdk.aws_ec2.Port.tcp(500), 'Allow IKEv1 & IKEv2 for VPN')
  sgPgdb.addIngressRule(cdk.aws_ec2.Peer.anyIpv4(), cdk.aws_ec2.Port.udp(4500), 'Allow NAT-T for VPN')

  /** create the postgres rds database */
  const pgdb = new cdk.aws_rds.DatabaseInstance(stack, 'shepherd-pgdb', {
    vpc,
    instanceIdentifier: 'shepherd-pgdb',
    engine: cdk.aws_rds.DatabaseInstanceEngine.postgres({
      version: cdk.aws_rds.PostgresEngineVersion.VER_13_10,
    }),
    autoMinorVersionUpgrade: true,
    instanceType: new cdk.aws_ec2.InstanceType('t3.xlarge'),
    allocatedStorage: 80,
    storageType: cdk.aws_rds.StorageType.GP2,
    deletionProtection: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    databaseName: 'arblacklist',  //legacy
    credentials: {
      username: 'postgres',
      password: cdk.SecretValue.plainText('postgres'),
    },
    vpcSubnets: {
      subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
    securityGroups: [sgPgdb],
  })

  /** vpn for direct access to the rds from various clients */

  const ec2 = cdk.aws_ec2

  // Assuming you've already uploaded your certificates to ACM
  const serverCertArn = 'arn:aws:acm:ap-southeast-1:615419003954:certificate/e3000bce-5f54-44bc-8af8-1de73186b2a2';
  const clientCertArn = 'arn:aws:acm:ap-southeast-1:615419003954:certificate/59851445-0bd2-4d0a-8210-faec4bcb6c52';

  // Create a Client VPN endpoint
  const clientVpnEndpoint = new ec2.CfnClientVpnEndpoint(stack, 'ClientVpnEndpoint', {
    authenticationOptions: [{
      type: 'certificate-authentication',
      mutualAuthentication: {
        clientRootCertificateChainArn: clientCertArn
      }
    }],
    serverCertificateArn: serverCertArn,
    clientCidrBlock: '10.2.0.0/16', // ensure no overlap with vpc cidr
    connectionLogOptions: {
      enabled: false, // can't get this to work
    },
    splitTunnel: true,
    vpcId: vpc.vpcId,
    securityGroupIds: [sgPgdb.securityGroupId],
    transportProtocol: 'udp',
  });

  // Associate VPC subnets with the Client VPN endpoint
  vpc.privateSubnets.map((subnet, index) => {
    new ec2.CfnClientVpnTargetNetworkAssociation(stack, `TargetNetworkAssociation${index}`, {
      clientVpnEndpointId: clientVpnEndpoint.ref,
      subnetId: subnet.subnetId
    });
  });

  // Optionally, add an authorization rule to allow access to the VPC
  new ec2.CfnClientVpnAuthorizationRule(stack, 'ClientVpnAuthorization', {
    clientVpnEndpointId: clientVpnEndpoint.ref,
    targetNetworkCidr: vpc.vpcCidrBlock,
    authorizeAllGroups: true,
    description: 'Allow access to the VPC'
  });


  return {
    sgPgdb,
    pgdb,
  }
}
