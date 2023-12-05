import { Duration, Stack, aws_cloudwatch, aws_cloudwatch_actions, aws_ec2, aws_sns } from 'aws-cdk-lib'

export const inputQMetricAndNotifications = (
	stack: Stack,
	vpc: aws_ec2.Vpc,
	sqsInputQueueName: string,
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
		threshold: 300,
		evaluationPeriods: 1,
		alarmDescription: 'shepherd2-input-q a message age is too old',
		alarmName: 'shepherdInputAgeAlarm',
		actionsEnabled: true,
	})
	const topic = new aws_sns.Topic(stack, 'inputAgeAlarmTopic', {
		displayName: 'shepherd2-input-q a message age is too old',
	})


	return {
		inputAgeMetricProps,
	}
}