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
echo "script_dir=$script_dir" 



echo "Deploying shepherd-infra-stack using cdk..." 
# cdk needs to be run from that project's root directory. so save the current dir and return to it after cdk
# save dir
current_dir="$(pwd)"
# run cdk
cd "$script_dir"
npx -y cdk deploy --require-approval never
# restore dir
cd "$current_dir"


echo 
echo "Retrieve stack outputs..." 
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
stack_output_to_env DB_HOST
stack_output_to_env AWS_FEEDER_QUEUE
stack_output_to_env AWS_INPUT_BUCKET
stack_output_to_env AWS_SQS_INPUT_QUEUE
stack_output_to_env LOG_GROUP_NAME
stack_output_to_env LB_ARN
stack_output_to_env LB_DNSNAME
