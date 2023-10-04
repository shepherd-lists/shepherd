#! /bin/bash

# exit on errors
set -euo pipefail

# check script arguments
if [ $# -le 0 ]; then
	echo "usage: $0 [--additional-options] deploy | destroy | bootstrap | synth "
	exit 1
fi

# for relative paths
export SCRIPT_DIR=$(dirname "$(realpath $0)")
echo "SCRIPT_DIR=$SCRIPT_DIR"

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# check for mandatory vars here
	if [[ -z $SLACK_PROBE ]]; then
		echo "ERROR: missing mandatory .env var SLACK_PROBE"
		exit 1
	fi
else
	echo "file .env not found. exiting"
	exit 1
fi

echo "Starting $(realpath $0) @ $(date "+%Y-%m-%d %H:%M:%S%z") $AWS_DEFAULT_REGION"		2>&1 | tee -a setup.log

# npx cdk --region=XXXX --profile=XXXs 
# can also use standard env vars:
# 	AWS_DEFAULT_REGION
# 	AWS_ACCESS_KEY_ID
# 	AWS_SECRET_ACCESS_KEY
## for no prompt, use: npx cdk deploy --require-approval never

echo "cd $SCRIPT_DIR"
cd $SCRIPT_DIR
echo "running: npx -y cdk $@"
npx -y cdk $@
