#!/bin/bash

ts=`date +"%Y%m%d%H%M%S"`
export IMAGE_TAG=$ts

docker compose -f docker-compose.yml -f docker-compose.aws.yml build $1
docker compose -f docker-compose.yml -f docker-compose.aws.yml push $1
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml up $1