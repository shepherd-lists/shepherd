#!/bin/bash

#for .env scope in this script
export $(egrep -v '^#' .env | xargs)

# ts=`date +"%Y%m%d%H%M%S"`
# export IMAGE_TAG=$ts

export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
docker logout
aws ecr get-login-password --region $AWS_REGION | docker login --password-stdin --username AWS $IMAGE_REPO

docker compose -f docker-compose.yml -f docker-compose.aws.yml build
docker compose -f docker-compose.yml -f docker-compose.aws.yml push
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml down
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml up
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml ps
