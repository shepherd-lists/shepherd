import { RemovalPolicy, Stack, aws_s3 } from 'aws-cdk-lib'
import { Config } from '../../Config'



export const buildListsBucket = (
	stack: Stack,
	config: Config,
) => {

	// //pointless versioning these legacy files + they are building up s3 costs
	// const noVersioningFiles = [
	// 	'addresses.txt',
	// 	'blacklist.txt',
	// 	'txidflagged.txt',
	// 	'txidowners.txt',
	// 	'rangelist.txt',
	// 	'rangeflagged.txt',
	// 	'rangeowners.txt',
	// 	/** .last_update files */
	// 	'flagged/.last_update',
	// 	'list/.last_update',
	// 	'owners/.last_update',
	// 	/** dnsr */
	// 	'dnsr/.last_update',
	// 	'dnsr/ranges.txt',
	// 	'dnsr/txids.txt',
	// ]

	const listsBucket = new aws_s3.Bucket(stack, 'listsBucket', {
		bucketName: `shepherd2-lists-${config.region}`,
		removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,

		objectOwnership: aws_s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
		accessControl: aws_s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,

		blockPublicAccess: {
			blockPublicAcls: true,
			ignorePublicAcls: true,
			blockPublicPolicy: true,
			restrictPublicBuckets: true,
		},

		versioned: false, //never set this to true! it can only be suspended once enabled.

	})

	return listsBucket;
}
