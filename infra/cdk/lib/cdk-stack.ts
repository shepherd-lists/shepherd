import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

if(!process.env.SLACK_PROBE) throw new Error('SLACK_PROBE env var not set')

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // const channelName = process.env.SLACK_CHANNEL_NAME!
    // const secretName = process.env.SLACK_SECRET_NAME!

    // const secret = new cdk.aws_secretsmanager.Secret(this, 'SlackWebhookSecret',  {
    //   secretName,
    //   //etc.
    // })

    const role = new cdk.aws_iam.Role(this, 'SnSSlackHandlerLambdaRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    const topic = new cdk.aws_sns.Topic(this, 'SnsSlackTopic', {
      topicName: 'sns-slack-topic-shepherd-gw-backing',
    })
    role.addManagedPolicy(cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'))
    // only required if your function lives in a VPC
    //role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"))

    const fn = new cdk.aws_lambda_nodejs.NodejsFunction(this, 'SnsSlackHandlerLambda', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SLACK_PROBE: process.env.SLACK_PROBE!,
      },
      entry: `${__dirname}/../lambda-sns-slack/index.ts`,
    })
    const eventSource = fn.addEventSource(new cdk.aws_lambda_event_sources.SnsEventSource(topic))

  }//EO C'tor
}
