#!/bin/bash

######################################
#   Prequisite: install aws-cli v2   #
######################################

echo "+====================================================+"			2>&1 | tee -a setup.log
echo "| Starting $(realpath $0) @ $(date --rfc-3339=seconds) |"		2>&1 | tee -a setup.log
echo "+====================================================+"			2>&1 | tee -a setup.log

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# should probably check for mandatory vars here
else
	echo "file .env not found. exiting"
	exit 1
fi
# for any relative paths
export SCRIPT_DIR=$(dirname "$(realpath $0)")
echo "SCRIPT_DIR=$SCRIPT_DIR" 2>&1 | tee -a setup.log


echo "Creating awscli shepherd profile ..." 2>&1 | tee -a setup.log

aws configure set profile.shepherd.region $AWS_DEFAULT_REGION
aws configure set profile.shepherd.aws_access_key_id $AWS_ACCESS_KEY_ID
aws configure set profile.shepherd.aws_secret_access_key $AWS_SECRET_ACCESS_KEY

echo "Getting AWS_ACCOUNT_ID ..." 2>&1 | tee -a setup.log

export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --profile shepherd --query Account --output text)
sed -i '/^AWS_ACCOUNT_ID/d' .env  # remove old line before adding new
echo "AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID" | tee -a .env

echo "Creating ecr repositories..." 2>&1 | tee -a setup.log

aws ecr create-repository --repository-name shepherd-webserver  2>&1 | tee -a setup.log
aws ecr create-repository --repository-name shepherd-scanner    2>&1 | tee -a setup.log
aws ecr create-repository --repository-name shepherd-rating     2>&1 | tee -a setup.log
aws ecr create-repository --repository-name shepherd-http-api   2>&1 | tee -a setup.log


echo "Creating VPC, adding ID to .env, all the network stuff, via aws.template cfn" 2>&1 | tee -a setup.log

aws cloudformation deploy \
	--template-file $SCRIPT_DIR/aws.template \
	--stack-name shepherd-aws-stack

export AWS_VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name shepherd-aws-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ShepherdVPC'].OutputValue" \
  --output text)

sed -i '/^AWS_VPC_ID/d' .env  # remove old line before adding new
echo "AWS_VPC_ID=$AWS_VPC_ID" | tee -a .env

export AWS_SECURITY_GROUP_ID=$(aws cloudformation describe-stacks \
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

