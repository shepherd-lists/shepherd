#!/bin/bash
if [ -z "$1" ]; then
	echo 'No argument for grep supplied'
	exit 1
fi

docker compose -p nsfw-test -f docker-compose.test.yml build 
docker compose -p nsfw-test -f docker-compose.test.yml run shep-runner knex migrate:latest
docker compose -p nsfw-test -f docker-compose.test.yml run test-service npm run test:grep $1
docker compose -p nsfw-test -f docker-compose.test.yml stop
docker compose -p nsfw-test -f docker-compose.test.yml rm -f
