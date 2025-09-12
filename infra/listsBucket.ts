import { RemovalPolicy, Stack, Duration, aws_ec2, aws_elasticloadbalancingv2, aws_logs, aws_s3 } from 'aws-cdk-lib'
import { Config } from '../../../Config'



export const buildListsBucket = (
	stack: Stack,
	config: Config,
) => {

	//pointless versioning these legacy files + they are building up s3 costs
	const noVersioningFiles = [
		'addresses.txt',
		'blacklist.txt',
		'txidflagged.txt',
		'txidowners.txt',
		'rangelist.txt',
		'rangeflagged.txt',
		'rangeowners.txt',
		/** .last_update files */
		'flagged/.last_update',
		'list/.last_update',
		'owners/.last_update',
		/** dnsr */
		'dnsr/.last_update',
		'dnsr/ranges.txt',
		'dnsr/txids.txt',
	]

	const listsBucket = new aws_s3.Bucket(stack, 'listsBucket', {
		bucketName: `shepherd-lists-${config.region}`,
		removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,

		objectOwnership: aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
		accessControl: aws_s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,

		blockPublicAccess: {
			blockPublicAcls: true,
			ignorePublicAcls: true,
			blockPublicPolicy: true,
			restrictPublicBuckets: true,
		},

		versioned: true, //enable versioning

		//expire noncurrent versions asap
		lifecycleRules: noVersioningFiles.map(filename => ({
			id: `${filename.split('.')[0]}-no-versioning`,
			enabled: true,
			prefix: filename,
			noncurrentVersionExpiration: Duration.days(1),
		})),

	})


	return listsBucket;
}
