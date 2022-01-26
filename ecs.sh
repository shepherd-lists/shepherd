#!/bin/bash

if [[ `uname -m` == 'arm64' && `uname -s` == 'Darwin' ]]; then
	echo "ABORTING! The container images are currently not building on M1 Silicon"
	exit 1
fi

#for .env scope in this script
export $(egrep -v '^#' .env | xargs)

echo "Remove existing docker ecs context..."
docker context rm ecs

echo "Creating docker ecs context ..."
docker context create ecs ecs --from-env

export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
echo $IMAGE_REPO

docker logout
aws ecr get-login-password --region $AWS_DEFAULT_REGION --profile shepherd | docker login --password-stdin --username AWS $IMAGE_REPO

docker compose -f docker-compose.yml -f docker-compose.aws.yml build
docker compose -f docker-compose.yml -f docker-compose.aws.yml push
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml convert > "cfn.yml.$(date +"%Y.%m.%d-%H:%M").log"
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml down
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml up
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml ps

