import { Duration, Stack, aws_ec2, aws_lambda, aws_lambda_nodejs, aws_logs } from 'aws-cdk-lib'


export const createFn = (
	name: string,
	stack: Stack,
	init: {
		vpc: aws_ec2.IVpc,
		securityGroups: aws_ec2.ISecurityGroup[],
		memorySize?: number,
		timeout?: Duration,
		logGroup?: aws_logs.ILogGroup,
		environment: Record<string, string>,
	},
) => {

	const { vpc, securityGroups, memorySize, timeout, logGroup, environment } = init

	const fnOwnerTable = new aws_lambda_nodejs.NodejsFunction(stack, name, {
		runtime: aws_lambda.Runtime.NODEJS_20_X,
		architecture: aws_lambda.Architecture.X86_64,
		memorySize, //defaults to 128
		handler: 'handler',
		entry: new URL(`../lambdas/${name}/index.ts`, import.meta.url).pathname,
		bundling: {
			format: aws_lambda_nodejs.OutputFormat.ESM,
			banner: 'import { createRequire } from \'module\';const require = createRequire(import.meta.url);',
		},
		timeout: timeout || Duration.minutes(15), //default to max
		environment,
		vpc,
		vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
		securityGroups,
		logGroup,
	})

	return fnOwnerTable;
}