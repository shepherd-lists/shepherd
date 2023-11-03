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
echo "script_dir=$script_dir"


echo "Deploying shepherd-services stack using cdk..."
# cdk needs to be run from that project's root directory. so save the current dir and return to it after cdk
current_dir="$(pwd)" # save dir
# run cdk
cd "$script_dir"
npx -y cdk synth > /dev/null	# check for errors before deploying
npx -y cdk deploy --require-approval never
cd "$current_dir" # restore dir


