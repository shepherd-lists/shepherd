#!/bin/bash

#for .env scope in this script
export $(egrep -v '^#' .env | xargs)

OLD_REGION=$(aws configure get region)
aws configure set region $AWS_REGION

export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
docker logout
aws ecr get-login-password --region $AWS_REGION | docker login --password-stdin --username AWS $IMAGE_REPO

docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml down

aws configure set region $OLD_REGION