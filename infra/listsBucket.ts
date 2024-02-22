import { RemovalPolicy, Stack, aws_ec2, aws_elasticloadbalancingv2, aws_elasticloadbalancingv2_targets, aws_iam, aws_logs, aws_s3 } from 'aws-cdk-lib'
import { Config } from '../../../Config'
import { createFn } from './createFn'



export const buildListsBucket = (
	stack: Stack,
	init: {
		config: Config,
		vpc: aws_ec2.IVpc,
		logGroupServices: aws_logs.ILogGroup,
		environment: Record<string, string>,
		listener: aws_elasticloadbalancingv2.IApplicationListener,
	},
) => {
	const { config, vpc, logGroupServices, environment, listener } = init

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

		// cors: [{
		// 	allowedMethods: [aws_s3.HttpMethods.GET, aws_s3.HttpMethods.HEAD],
		// 	allowedOrigins: ['*'],
		// 	allowedHeaders: ['*'],
		// }],
	})

	// const ipRestrictPolicyAddresses = new aws_iam.PolicyStatement({
	// 	effect: aws_iam.Effect.ALLOW,
	// 	principals: [new aws_iam.AnyPrincipal()],
	// 	actions: ['s3:GetObject'],
	// 	resources: [listsBucket.bucketArn + '/addresses.txt'],
	// 	conditions: {
	// 		'IpAddress': {
	// 			'aws:SourceIp': [
	// 				...config.txids_whitelist,
	// 			]
	// 		}
	// 	},
	// })

	// const ipRestrictPolicyRanges = new aws_iam.PolicyStatement({
	// 	effect: aws_iam.Effect.ALLOW,
	// 	principals: [new aws_iam.AnyPrincipal()],
	// 	actions: ['s3:GetObject'],
	// 	resources: [listsBucket.bucketArn + '/rangelist.txt'],
	// 	conditions: {
	// 		'IpAddress': {
	// 			'aws:SourceIp': [
	// 				...config.ranges_whitelist.map(range => range.server),
	// 			]
	// 		}
	// 	},
	// })

	// listsBucket.addToResourcePolicy(ipRestrictPolicyAddresses)
	// listsBucket.addToResourcePolicy(ipRestrictPolicyRanges)

	/** so you can't currently use an s3 as an alb target :-( */

	/** use a lambda as intermediary from alb to s3 */

	const fnListsBucket = createFn('fnListsBucket', stack, {
		vpc,
		securityGroups: [],
		logGroup: logGroupServices,
		environment: {
			...environment,
			LISTS_BUCKET: listsBucket.bucketName,
		},
	})

	listsBucket.grantRead(fnListsBucket)

	const overrideTG = new aws_elasticloadbalancingv2.ApplicationTargetGroup(stack, 'overrideTargetGroup', { vpc, })

	overrideTG.addTarget(new aws_elasticloadbalancingv2_targets.LambdaTarget(fnListsBucket))

	listener.addTargetGroups('overrideTarget', {
		priority: 1,
		conditions: [aws_elasticloadbalancingv2.ListenerCondition.pathPatterns(['/addresses.txt', '/rangelist.txt'])],
		targetGroups: [overrideTG],
	})



	return listsBucket;
}
