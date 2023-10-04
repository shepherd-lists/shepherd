import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfraStack extends cdk.Stack {
  constructor(app: Construct, id: string, props?: cdk.StackProps) {
    super(app, id, props);

    /** create the main network stack */

    const vpc = new cdk.aws_ec2.Vpc(this, 'shepherd-vpc', {
      vpcName: 'shepherd-vpc',
      maxAzs: 2,
      natGateways: 1,
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
    const cluster = new cdk.aws_ecs.Cluster(this, 'shepherd-cluster', {
      vpc,
      clusterName: 'shepherd-cluster',
    })

    /** create the postgres rds database */
    const sgPgdb = new cdk.aws_ec2.SecurityGroup(this, 'shepherd-pgdb-sg', {
      vpc: vpc,
      allowAllOutbound: true,
      securityGroupName: 'shepherd-pgdb-sg',
    })
    sgPgdb.addIngressRule(cdk.aws_ec2.Peer.ipv4(vpc.vpcCidrBlock), cdk.aws_ec2.Port.tcp(5432), 'allow db traffic')

    const pgdb = new cdk.aws_rds.DatabaseInstance(this, 'shepherd-pgdb', {
      vpc,
      instanceIdentifier: 'shepherd-pgdb',
      engine: cdk.aws_rds.DatabaseInstanceEngine.postgres({
        version: cdk.aws_rds.PostgresEngineVersion.VER_13_10,
      }),
      autoMinorVersionUpgrade: true,
      instanceType: new cdk.aws_ec2.InstanceType('db.t3.xlarge'),
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




    // /** SG that allows egress and internal communication on ports 5432 and 84 */
    // const sgDefault = new cdk.aws_ec2.SecurityGroup(this, 'shepherd-default-sg', {
    //   vpc: vpc,
    //   allowAllOutbound: true,
    //   securityGroupName: 'shepherd-default-sg',
    // })
    // sgDefault.addIngressRule(sgDefault, cdk.aws_ec2.Port.tcp(5432), 'allow db traffic')
    // sgDefault.addIngressRule(sgDefault, cdk.aws_ec2.Port.tcp(84), 'allow http-api traffic')
  }
}


