import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

throw new Error('This stack is not ready for production use. It is a work in progress.')

/** env inputs */
if(!process.env.SLACK_PROBE) throw new Error('SLACK_PROBE env var not set')
if(!process.env.LOG_GROUP_ARN) throw new Error('LOG_GROUP_ARN env var not set')
if(!process.env.GW_URLS) console.log('Warning : GW_URLS env var not set')
if(!process.env.RANGELIST_ALLOWED) throw new Error('RANGELIST_ALLOWED env var not set')
const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
const rangelistIPs: string[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
rangelistIPs.shift() // pop off first IP. this should always be a test IP
const serverIds = [...gwUrls, ...rangelistIPs]

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /** Slack notifications plan
     * connect to shepherd logs
     * create metricfilter for each checked server
     * make alarm for each metricfilter
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

    /** do the following for each serverId (workaround as dimensions not working in the cloudwatch Alarms) */
    serverIds.map(serverId => {

      /* sanitize the name for cfn */
      const sanitizedId = serverId.replace(/[^a-z0-9_]/ig, '-') //replace non-alphanumeric
      
      /** create an alarm straight from `MetricFilter->metric->createAlarm` */
      const alarmNotBlocked = new cdk.aws_logs.MetricFilter(this, `NotBlocked-${sanitizedId}-MetricFilter`, {
        logGroup,
        metricName: sanitizedId,
        metricNamespace: 'shepherd',
        metricValue: '1',
        unit: cdk.aws_cloudwatch.Unit.COUNT,
        filterPattern: cdk.aws_logs.FilterPattern.all(
          cdk.aws_logs.FilterPattern.stringValue('$.eventType', '=', 'not-blocked'),
          cdk.aws_logs.FilterPattern.stringValue('$.server', '=', serverId),
        ),
        // dimensions: { serverId: '$.server' }, // Alarms don't work
      })
      .metric({
        // period: cdk.Duration.seconds(10), /* default period 5 mins */
        statistic: cdk.aws_cloudwatch.Stats.SUM,
        // unit: cdk.aws_cloudwatch.Unit.COUNT,
      }) 
      .createAlarm(this, `NotBlocked-${sanitizedId}-Alarm`, {
        threshold: 0,
        comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: serverId,
      })
  
      /** connect alarm to topic */
      alarmNotBlocked.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(topic))
      alarmNotBlocked.addOkAction(new cdk.aws_cloudwatch_actions.SnsAction(topic))
    })




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
