#!/bin/bash

docker compose -f docker-compose.yml -f docker-compose.aws.yml build
docker compose -f docker-compose.yml -f docker-compose.aws.yml push
docker --context ecs compose -f docker-compose.yml -f docker-compose.aws.yml up