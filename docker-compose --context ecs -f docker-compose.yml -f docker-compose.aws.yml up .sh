#!/bin/bash
docker-compose --context ecs -f docker-compose.yml -f docker-compose.aws.yml up