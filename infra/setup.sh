#!/bin/bash

######################################
#   Prequisite: install aws-cli v2   #
######################################

# exit on errors
set -euo pipefail


# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# should probably check for mandatory vars here
else
	echo "file .env not found. exiting"
	exit 1
fi
# for any relative paths
export script_dir=$(dirname "$(realpath $0)")
echo "script_dir=$script_dir" 2>&1 | tee -a setup.log


# ** removing ECR repo section for now. **


echo "Deploying shepherd-infra-stack using cdk..." 2>&1 | tee -a setup.log
# cdk needs to be run from that project's root directory. so save the current dir and return to it after cdk
# save dir
current_dir="$(pwd)"
# run cdk
cd "$script_dir"
npx -y cdk deploy --require-approval never
# restore dir
cd "$current_dir"


echo 
echo "Retrieve stack outputs..." 2>&1 | tee -a setup.log
aws_stack_outputs=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-infra-stack" \
	--query "Stacks[0].Outputs" \
	--output json)

function stack_output_to_env {
	local name=$1
	local name_no_underscores=${name//_/} # allow for cdk/cfn quirk 
	value=$(echo $aws_stack_outputs | jq -r ".[] | select(.OutputKey==\"$name_no_underscores\").OutputValue")
	export "$name=$value"
	sed -i "/^$name/d" .env  # remove old line before adding new
	echo "$name=$value" | tee -a .env
}

stack_output_to_env AWS_ACCOUNT_ID
stack_output_to_env AWS_VPC_ID
stack_output_to_env AWS_SECURITY_GROUP_ID
stack_output_to_env DB_HOST
stack_output_to_env AWS_FEEDER_QUEUE
stack_output_to_env AWS_INPUT_BUCKET
stack_output_to_env AWS_SQS_INPUT_QUEUE
stack_output_to_env LOG_GROUP_ARN
stack_output_to_env LB_ARN
stack_output_to_env LB_DNSNAME



## SUBNETs and ROUTETABLE are used in legacy lambda-prod.sh only. 

# export SUBNET1=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="Subnet1").OutputValue')
# sed -i '/^SUBNET1/d' .env  # remove old line before adding new
# echo "SUBNET1=$SUBNET1" | tee -a .env

# export SUBNET2=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="Subnet2").OutputValue')
# sed -i '/^SUBNET2/d' .env  # remove old line before adding new
# echo "SUBNET2=$SUBNET2" | tee -a .env

# export SUBNET3=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="Subnet3").OutputValue')
# sed -i '/^SUBNET3/d' .env  # remove old line before adding new
# echo "SUBNET3=$SUBNET3" | tee -a .env

# export ROUTETABLE=$(echo $aws_stack_outputs | jq -r '.[] | select(.OutputKey=="RouteTable").OutputValue')
# sed -i '/^ROUTETABLE/d' .env  # remove old line before adding new
# echo "ROUTETABLE=$ROUTETABLE" | tee -a .env



