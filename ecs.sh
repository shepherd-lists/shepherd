#!/bin/bash

# if [[ `uname -m` == 'arm64' && `uname -s` == 'Darwin' ]]; then
# 	echo "ABORTING! The container images are currently not building on M1 Silicon"
# 	exit 1
# fi

# import .env vars
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# should probably check for mandatory vars here !!
	#TODO: if [[ -z $VARNAME1 || -z $VARNAME2 ...etc ]]
	# make sure .env ends in newline
	lastchar=$(tail -c 1 .env)
	if [ "$lastchar" != "" ]; then 
		echo >> .env
	fi
else
	echo "file .env not found. exiting"
	exit 1
fi
# for any relative paths
export SCRIPT_DIR=$(dirname "$(realpath $0)")
echo "SCRIPT_DIR=$SCRIPT_DIR" 2>&1 | tee -a setup.log

echo "Remove existing docker ecs context..."
docker context rm ecs

echo "Creating docker ecs context ..."
docker context create ecs ecs --from-env

export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
echo $IMAGE_REPO

docker logout
aws ecr get-login-password --region $AWS_DEFAULT_REGION --profile shepherd | docker login --password-stdin --username AWS $IMAGE_REPO

docker compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.aws.yml build
docker compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.aws.yml push
docker --context ecs compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.aws.yml convert > "cfn.yml.$(date +"%Y.%m.%d-%H:%M").log"
docker --context ecs compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.aws.yml up
docker --context ecs compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.aws.yml ps

