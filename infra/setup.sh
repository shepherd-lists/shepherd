#!/bin/bash

###################################################
#   Prequisite: install and configure aws-cli@2   #
###################################################

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
else
	echo "file .env not found. exiting"
	exit 1
fi

echo "Setting AWS_ACCOUNT_ID ..." 2>&1 | tee -a setup.log

export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed -i '/^AWS_ACCOUNT_ID/d' .env  # remove old line before adding new
echo "AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID" | tee -a .env

echo "Creating ecr repositories..." 2>&1 | tee -a setup.log

aws ecr create-repository --region $AWS_REGION --repository-name shepherd-webserver  2>&1 | tee -a setup.log
aws ecr create-repository --region $AWS_REGION --repository-name shepherd-scanner    2>&1 | tee -a setup.log
aws ecr create-repository --region $AWS_REGION --repository-name shepherd-rating     2>&1 | tee -a setup.log
aws ecr create-repository --region $AWS_REGION --repository-name shepherd-http-api   2>&1 | tee -a setup.log


echo "Creating VPC, adding ID to .env, all the network stuff, via networks.template cfn" 2>&1 | tee -a setup.log

aws cloudformation deploy --region $AWS_REGION \
	--template-file ./infra/cfn-templates/aws.template \
	--stack-name shepherd-aws-stack

export AWS_VPC_ID=$(aws cloudformation describe-stacks \
	--region $AWS_REGION \
  --stack-name shepherd-aws-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ShepherdVPC'].OutputValue" \
  --output text)

sed -i '/^AWS_VPC_ID/d' .env  # remove old line before adding new
echo "AWS_VPC_ID=$AWS_VPC_ID" | tee -a .env

export AWS_SECURITY_GROUP_ID=$(aws cloudformation describe-stacks \
	--region $AWS_REGION \
  --stack-name shepherd-aws-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ShepherdSecurityGroup'].OutputValue" \
  --output text)
sed -i '/^AWS_SECURITY_GROUP_ID/d' .env  # remove old line before adding new
echo "AWS_SECURITY_GROUP_ID=$AWS_SECURITY_GROUP_ID" | tee -a .env

export DB_HOST=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='RdsEndpointUrl'].OutputValue" \
	--output text)
sed -i '/^DB_HOST/d' .env  # remove old line before adding new
echo "DB_HOST=$DB_HOST" | tee -a .env

