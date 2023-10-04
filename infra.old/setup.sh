#!/bin/bash

######################################
#   Prequisite: install aws-cli v2   #
######################################

# exit on errors
set -euo pipefail

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


echo "Creating ecr repositories..." 2>&1 | tee -a setup.log

function create_repo {
	if ! aws ecr describe-repositories --repository-names $1 2>&-; then
		echo "creating ecr repo $1..."
		aws ecr create-repository --repository-name $1  2>&1 | tee -a setup.log
	fi
}
function delete_repo {
	if aws ecr describe-repositories --repository-names $1 2>&-; then
		echo "deleting ecr repo $1..."
		aws ecr delete-repository --repository-name $1 --force  2>&1 | tee -a setup.log
	fi
}

create_repo 'shepherd'
# these are removed
delete_repo 'shepherd-webserver'
delete_repo 'shepherd-scanner'
delete_repo 'shepherd-http-api'
delete_repo 'shepherd-feeder'
delete_repo 'shepherd-fetchers'
delete_repo 'shepherd-rating'


echo "Deploying stack using aws.template..." 2>&1 | tee -a setup.log

aws cloudformation deploy \
	--template-file $SCRIPT_DIR/aws.template \
	--stack-name shepherd-aws-stack

echo 
echo "Retrieve stack outputs..." 2>&1 | tee -a setup.log
aws_stack_outputs=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-aws-stack" \
	--query "Stacks[0].Outputs" \
	--output json)

export AWS_ACCOUNT_ID=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="AwsAccountId").OutputValue')
sed -i '/^AWS_ACCOUNT_ID/d' .env  # remove old line before adding new
echo "AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID" | tee -a .env

export AWS_VPC_ID=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="ShepherdVPC").OutputValue')
sed -i '/^AWS_VPC_ID/d' .env  # remove old line before adding new
echo "AWS_VPC_ID=$AWS_VPC_ID" | tee -a .env

export AWS_SECURITY_GROUP_ID=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="ShepherdSecurityGroup").OutputValue')
sed -i '/^AWS_SECURITY_GROUP_ID/d' .env  # remove old line before adding new
echo "AWS_SECURITY_GROUP_ID=$AWS_SECURITY_GROUP_ID" | tee -a .env

export DB_HOST=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="RdsEndpointUrl").OutputValue')
sed -i '/^DB_HOST/d' .env  # remove old line before adding new
echo "DB_HOST=$DB_HOST" | tee -a .env

export AWS_FEEDER_QUEUE=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="SQSFeederQueue").OutputValue')
sed -i '/^AWS_FEEDER_QUEUE/d' .env  # remove old line before adding new
echo "AWS_FEEDER_QUEUE=$AWS_FEEDER_QUEUE" | tee -a .env

export AWS_INPUT_BUCKET=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="S3Bucket").OutputValue')
sed -i '/^AWS_INPUT_BUCKET/d' .env  # remove old line before adding new
echo "AWS_INPUT_BUCKET=$AWS_INPUT_BUCKET" | tee -a .env

export AWS_SQS_INPUT_QUEUE=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="SQSInputQueue").OutputValue')
sed -i '/^AWS_SQS_INPUT_QUEUE/d' .env  # remove old line before adding new
echo "AWS_SQS_INPUT_QUEUE=$AWS_SQS_INPUT_QUEUE" | tee -a .env

export LOG_GROUP_ARN=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="LogGroupArn").OutputValue')
sed -i '/^LOG_GROUP_ARN/d' .env  # remove old line before adding new
echo "LOG_GROUP_ARN=$LOG_GROUP_ARN" | tee -a .env

export SUBNET1=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="Subnet1").OutputValue')
sed -i '/^SUBNET1/d' .env  # remove old line before adding new
echo "SUBNET1=$SUBNET1" | tee -a .env

export SUBNET2=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="Subnet2").OutputValue')
sed -i '/^SUBNET2/d' .env  # remove old line before adding new
echo "SUBNET2=$SUBNET2" | tee -a .env

export SUBNET3=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="Subnet3").OutputValue')
sed -i '/^SUBNET3/d' .env  # remove old line before adding new
echo "SUBNET3=$SUBNET3" | tee -a .env

export ROUTETABLE=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="RouteTable").OutputValue')
sed -i '/^ROUTETABLE/d' .env  # remove old line before adding new
echo "ROUTETABLE=$ROUTETABLE" | tee -a .env

# export ELB_ARN=$(aws cloudformation describe-stacks \
# 	--stack-name shepherd-aws-stack \
# 	--query "Stacks[0].Outputs[?OutputKey=='LoadBalancerArn'].OutputValue" \
# 	--output text)
# sed -i '/^ELB_ARN/d' .env  # remove old line before adding new
# echo "ELB_ARN=$ELB_ARN" | tee -a .env

# export ELB_DNSNAME=$(aws cloudformation describe-stacks \
# 	--stack-name shepherd-aws-stack \
# 	--query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDnsName'].OutputValue" \
# 	--output text)
# sed -i '/^ELB_DNSNAME/d' .env  # remove old line before adding new
# echo "ELB_DNSNAME=$ELB_DNSNAME" | tee -a .env

