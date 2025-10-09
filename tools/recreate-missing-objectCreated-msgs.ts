import 'dotenv/config'
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { SQSClient, ReceiveMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";

const syncS3ToSQS = async (bucketName: string, queueUrl: string, region: string) => {
	const s3 = new S3Client({ region });
	const sqs = new SQSClient({ region });

	// Get all S3 object keys
	const s3Keys = new Set<string>();
	let token: string | undefined;
	do {
		const res = await s3.send(new ListObjectsV2Command({
			Bucket: bucketName,
			ContinuationToken: token
		}));
		res.Contents?.forEach(obj => obj.Key && s3Keys.add(obj.Key));
		token = res.NextContinuationToken;
		console.info(`Found ${s3Keys.size} objects in S3`);
	} while (token);

	// Get object keys from queue messages
	const queueKeys = new Set<string>();
	let hasMessages = true;
	while (hasMessages) {
		const res = await sqs.send(new ReceiveMessageCommand({
			QueueUrl: queueUrl,
			MaxNumberOfMessages: 10,
			WaitTimeSeconds: 1,
		}));

		if (!res.Messages?.length) {
			hasMessages = false;
		} else {
			res.Messages.forEach(msg => {
				const body = JSON.parse(msg.Body!);
				body.Records?.forEach((r: any) => queueKeys.add(r.s3.object.key));
			});
			console.info(`Found ${queueKeys.size} objects in queue`);
		}
	}

	// Send messages for missing objects (concurrent)
	const missing = [...s3Keys].filter(key => !queueKeys.has(key));
	const concurrency = 50;
	let done = 0;

	for (let i = 0; i < missing.length; i += concurrency) {
		const batch = missing.slice(i, i + concurrency);
		await Promise.all(batch.map(key =>
			sqs.send(new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({
					Records: [{
						eventVersion: "2.1",
						eventSource: "aws:s3",
						eventName: "ObjectCreated:REDRIVE",
						eventTime: new Date().toISOString(),
						s3: {
							s3SchemaVersion: "1.0",
							bucket: {
								name: bucketName,
								arn: `arn:aws:s3:::${bucketName}`
							},
							object: {
								key: key,
								size: 4097 //??
							}
						}
					}]
				})
			}))
		));
		console.info(`Created ${done += batch.length}/${missing.length} messages`);
	}

	console.log(`Done. ${s3Keys.size} in S3, ${queueKeys.size} in queue`);
}

// Usage
syncS3ToSQS(
	process.env.AWS_INPUT_BUCKET!,
	process.env.AWS_SQS_INPUT_QUEUE!,
	'ap-southeast-1'
)
