#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { ServicesStack } from '../lib/services-stack'


const app = new cdk.App()
new ServicesStack(app, 'ServicesAwsStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  stackName: 'shepherd-services',
  description: 'Shepherd services stack: ecs, lambdas, etc',
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
})
