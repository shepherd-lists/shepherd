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


