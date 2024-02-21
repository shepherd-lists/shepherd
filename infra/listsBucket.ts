import { RemovalPolicy, Stack, aws_iam, aws_s3 } from 'aws-cdk-lib'
import { Config } from '../../../Config'



export const buildListsBucket = (
	stack: Stack,
	config: Config,
) => {

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

		cors: [{
			allowedMethods: [aws_s3.HttpMethods.GET, aws_s3.HttpMethods.HEAD],
			allowedOrigins: ['*'],
			allowedHeaders: ['*'],
		}],
	})

	const ipRestrictPolicyAddresses = new aws_iam.PolicyStatement({
		effect: aws_iam.Effect.ALLOW,
		principals: [new aws_iam.AnyPrincipal()],
		actions: ['s3:GetObject'],
		resources: [listsBucket.bucketArn + '/addresses.txt'],
		conditions: {
			'IpAddress': {
				'aws:SourceIp': [
					...config.txids_whitelist,
				]
			}
		},
	})

	const ipRestrictPolicyRanges = new aws_iam.PolicyStatement({
		effect: aws_iam.Effect.ALLOW,
		principals: [new aws_iam.AnyPrincipal()],
		actions: ['s3:GetObject'],
		resources: [listsBucket.bucketArn + '/rangelist.txt'],
		conditions: {
			'IpAddress': {
				'aws:SourceIp': [
					...config.ranges_whitelist.map(range => range.server),
				]
			}
		},
	})

	listsBucket.addToResourcePolicy(ipRestrictPolicyAddresses)
	listsBucket.addToResourcePolicy(ipRestrictPolicyRanges)



	return listsBucket;
}
