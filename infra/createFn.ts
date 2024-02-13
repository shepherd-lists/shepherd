import { Duration, Stack, aws_ec2, aws_lambda, aws_lambda_nodejs } from 'aws-cdk-lib'


export const createFn = async (
	name: string,
	stack: Stack,
	vpc: aws_ec2.IVpc,
	securityGroups: aws_ec2.ISecurityGroup[],
	environment: Record<string, string>,
	timeout: Duration = Duration.minutes(15),
) => {

	const fnOwnerTable = new aws_lambda_nodejs.NodejsFunction(stack, name, {
		runtime: aws_lambda.Runtime.NODEJS_20_X,
		architecture: aws_lambda.Architecture.X86_64,
		handler: 'handler',
		entry: new URL(`../lambdas/${name}/index.ts`, import.meta.url).pathname,
		bundling: {
			format: aws_lambda_nodejs.OutputFormat.ESM,
			banner: 'import { createRequire } from \'module\';const require = createRequire(import.meta.url);',
		},
		timeout, //defaults to max
		environment,
		vpc,
		vpcSubnets: { subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
		securityGroups,
	})

}