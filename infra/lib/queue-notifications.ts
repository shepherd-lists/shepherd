import { Stack, aws_cloudwatch, aws_ec2 } from 'aws-cdk-lib'

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

	return {
		inputAgeMetricProps,
	}
}