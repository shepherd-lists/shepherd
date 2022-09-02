#! /bin/bash

# exit on errors
set -euo pipefail

# import .env vars
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


export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
docker logout
aws ecr get-login-password --region $AWS_DEFAULT_REGION --profile shepherd | docker login --password-stdin --username AWS $IMAGE_REPO

docker --context ecs compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.aws.yml down

