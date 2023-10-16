#!/bin/bash

##################################
# Prequisites: check ADVANCED.md #
##################################

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



echo "Deploying shepherd-services stack using cdk..." 2>&1 | tee -a setup.log
# cdk needs to be run from that project's root directory. so save the current dir and return to it after cdk
current_dir="$(pwd)" # save dir
# run cdk
cd "$script_dir"
npx -y cdk synth > "cfn-services.$(date +"%Y.%m.%d-%H:%M").yml"
npx -y cdk deploy --require-approval never
cd "$current_dir" # restore dir


echo "Retrieve shepherd-services stack outputs..." 2>&1 | tee -a setup.log
shepherd_services_outputs=$(aws cloudformation describe-stacks \
	--stack-name "shepherd-services" \
	--query "Stacks[0].Outputs" \
	--output json)

function stack_output_to_env {
	local name=$1
	local name_no_underscores=${name//_/} # allow for cdk/cfn quirk 
	value=$(echo $shepherd_services_outputs | jq -r ".[] | select(.OutputKey==\"$name_no_underscores\").OutputValue")
	export "$name=$value"
	sed -i "/^$name/d" .env  # remove old line before adding new
	echo "$name=$value" | tee -a .env
}

stack_output_to_env ShepherdCluster
