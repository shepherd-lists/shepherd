import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** env inputs */
if(!process.env.SLACK_PROBE) throw new Error('SLACK_PROBE env var not set')
if(!process.env.LOG_GROUP_ARN) throw new Error('LOG_GROUP_ARN env var not set')


export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /** Slack notifications plan
     * connect to shepherd logs
     * create metricfilter
     * make alarm for metricfilter
     * send alarms to sns
     * sns sends to lambda
     * lambda sends to slack
     */

    /** sns topic to join the alarm to the slack-lambda */
    const topic = new cdk.aws_sns.Topic(this, 'SnsSlackTopic', {
      topicName: 'sns-slack-topic-shepherd-gw-backing',
    })

    /** connect to external logs */ 
    const logGroup = cdk.aws_logs.LogGroup.fromLogGroupArn(this, 'LogGroup', process.env.LOG_GROUP_ARN!)

    /** create an alarm straight from `MetricFilter->metric->createAlarm` */
    const metricNotBlocked = new cdk.aws_logs.MetricFilter(this, 'NotBlockedMetricFilter', {
      logGroup,
      metricName: 'NotBlockedMetricFilter',
      metricNamespace: 'shepherd',
      metricValue: '1',
      unit: cdk.aws_cloudwatch.Unit.COUNT,
      filterPattern: cdk.aws_logs.FilterPattern.all(
        cdk.aws_logs.FilterPattern.stringValue('$.eventType', '=', 'not-blocked'),
        cdk.aws_logs.FilterPattern.stringValue('$.server', '=', '*'),
      ),
      // defaultValue: 0,
      // filterPattern: cdk.aws_logs.FilterPattern.allTerms('not-blocked'), // <= this creates alarms ok alone
      // dimensions: { serverId: '$.server' }, // Alarms don't work
    })
    .metric({
      /* default period 5 mins */
      period: cdk.Duration.seconds(10),
      statistic: cdk.aws_cloudwatch.Stats.SUM,
      // unit: cdk.aws_cloudwatch.Unit.COUNT,
      dimensionsMap: { serverId: '$.server'}, 
    }) 
    const alarmNotBlocked = new cdk.aws_cloudwatch.Alarm(this, 'NotBlockedAlarm', {
      metric: metricNotBlocked,
      threshold: 0,
      comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: true, 
      
    })

    /** connect alarm to topic */
    alarmNotBlocked.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(topic))
    alarmNotBlocked.addOkAction(new cdk.aws_cloudwatch_actions.SnsAction(topic))

    /* create lambda using `NodejsFunction` (ebuild) option */
    const role = new cdk.aws_iam.Role(this, 'SnSSlackHandlerLambdaRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    role.addManagedPolicy(cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'))
    // /* only required if your function lives in a VPC */
    // role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"))

    const lambda = new cdk.aws_lambda_nodejs.NodejsFunction(this, 'SnsSlackHandlerLambda', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SLACK_PROBE: process.env.SLACK_PROBE!,
      },
      entry: `${__dirname}/../lambda-sns-slack/index.ts`,
    })

    /* connect lambda to topic */
    lambda.addEventSource(new cdk.aws_lambda_event_sources.SnsEventSource(topic))



  }//EO C'tor
}
