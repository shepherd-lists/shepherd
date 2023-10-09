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

    /** cfn outputs */
    new cdk.CfnOutput(stack, 'AwsAccountId', { value: cdk.Aws.ACCOUNT_ID })
    new cdk.CfnOutput(stack, 'ShepherdVPC', { value: vpc.vpcId })
    new cdk.CfnOutput(stack, 'ShepherdSecurityGroup', { value: sgPgdb.securityGroupId })
    new cdk.CfnOutput(stack, 'RdsEndpointUrl', { value: pgdb.dbInstanceEndpointAddress })
    // new cdk.CfnOutput(stack, 'SQSFeederQueue', { value: sqsFeederQueue.queueUrl })
    // new cdk.CfnOutput(stack, 'S3Bucket', { value: S3Bucket.bucketName })
    // new cdk.CfnOutput(stack, 'SQSInputQueue', { value: sqsInputQueue.queueUrl })
    // new cdk.CfnOutput(stack, 'LogGroupArn', { value: shepherdServicesLogGroup.logGroupArn }) //move to services stack?
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



  return {
    sgPgdb,
    pgdb,
  }
}
