#!/bin/bash

#for .env scope in this script
export $(egrep -v '^#' .env | xargs)


export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
docker logout
aws ecr get-login-password --region $AWS_DEFAULT_REGION --profile shepherd | docker login --password-stdin --username AWS $IMAGE_REPO

docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml down

