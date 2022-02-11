#!/bin/bash

######################################
#   Prequisite: install aws-cli v2   #
######################################

echo "+====================================================+"			2>&1 | tee -a setup.log
echo "| Starting $(realpath $0) @ $(date "+%Y-%m-%d %H:%M:%S%z") |"		2>&1 | tee -a setup.log
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
echo -e "\n\n** N.B. Errors above about RepositoryAlreadyExistsException can be ignored. **\n\n"

echo "Deploying stack using aws.template..." 2>&1 | tee -a setup.log

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

export SUBNET1=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='Subnet1'].OutputValue" \
	--output text)
sed -i '/^SUBNET1/d' .env  # remove old line before adding new
echo "SUBNET1=$SUBNET1" | tee -a .env

export SUBNET2=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='Subnet2'].OutputValue" \
	--output text)
sed -i '/^SUBNET2/d' .env  # remove old line before adding new
echo "SUBNET2=$SUBNET2" | tee -a .env

export SUBNET3=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='Subnet3'].OutputValue" \
	--output text)
sed -i '/^SUBNET3/d' .env  # remove old line before adding new
echo "SUBNET3=$SUBNET3" | tee -a .env

export ROUTETABLE=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='RouteTable'].OutputValue" \
	--output text)
sed -i '/^ROUTETABLE/d' .env  # remove old line before adding new
echo "ROUTETABLE=$ROUTETABLE" | tee -a .env

export ELB_ARN=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='LoadBalancerArn'].OutputValue" \
	--output text)
sed -i '/^ELB_ARN/d' .env  # remove old line before adding new
echo "ELB_ARN=$ELB_ARN" | tee -a .env

export ELB_DNSNAME=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDnsName'].OutputValue" \
	--output text)
sed -i '/^ELB_DNSNAME/d' .env  # remove old line before adding new
echo "ELB_DNSNAME=$ELB_DNSNAME" | tee -a .env

