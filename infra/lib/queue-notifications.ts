import { Duration, Stack, aws_cloudwatch, aws_cloudwatch_actions, aws_ec2, aws_lambda, aws_lambda_event_sources, aws_lambda_nodejs, aws_logs, aws_sns } from 'aws-cdk-lib'

export const inputQMetricAndNotifications = (
	stack: Stack,
	vpc: aws_ec2.Vpc,
	sqsInputQueueName: string,
	slackPublic: string,
	logGroupInfra: aws_logs.LogGroup,
) => {

	/** we need to use this metric throughout shepherd, but you can't import metrics by lookup */
	const inputAgeMetricProps: aws_cloudwatch.MetricProps = {
		namespace: 'AWS/SQS',
		metricName: 'ApproximateAgeOfOldestMessage',
		statistic: 'Maximum',
		dimensionsMap: {
			QueueName: sqsInputQueueName,
		},
	}
	const unexportableMetric = new aws_cloudwatch.Metric(inputAgeMetricProps)

	/** create alarm */
	const inputAgeAlarm = new aws_cloudwatch.Alarm(stack, 'inputAgeAlarm', {
		metric: unexportableMetric,
		threshold: 9_000, //150 mins, 2.5 hrs
		evaluationPeriods: 1,
		alarmDescription: 'shepherd2-input-q oldest message age',
		alarmName: 'shepherdInputAgeAlarm',
		actionsEnabled: true,
	})

	/** create a slack posting lambda */
	const fnSlack = new aws_lambda_nodejs.NodejsFunction(stack, 'fnSlackInputAgeAlarm', {
		runtime: aws_lambda.Runtime.NODEJS_22_X,
		architecture: aws_lambda.Architecture.X86_64,
		handler: 'handler',
		entry: new URL('../lambdas/slack/index.ts', import.meta.url).pathname,
		bundling: {
			format: aws_lambda_nodejs.OutputFormat.ESM,
		},
		logGroup: logGroupInfra,
		// logFormat: aws_lambda.LogFormat.JSON,
		timeout: Duration.seconds(10),
		environment: {
			SLACK_PUBLIC: slackPublic,
		}
	})

	/** topic is just a pipe */
	const topic = new aws_sns.Topic(stack, 'inputAgeAlarmTopic')
	fnSlack.addEventSource(new aws_lambda_event_sources.SnsEventSource(topic))
	inputAgeAlarm.addAlarmAction(new aws_cloudwatch_actions.SnsAction(topic)) //lambda determines alarm state
	inputAgeAlarm.addOkAction(new aws_cloudwatch_actions.SnsAction(topic))


	return {
		inputAgeMetricProps,
	}
}