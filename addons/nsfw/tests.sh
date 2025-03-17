#!/bin/bash

docker compose -p nsfw-test -f docker-compose.test.yml build 
docker compose -p nsfw-test -f docker-compose.test.yml run shep-runner npx knex migrate:latest
docker compose -p nsfw-test -f docker-compose.test.yml run test-service npm test

docker compose -p nsfw-test -f docker-compose.test.yml stop
docker compose -p nsfw-test -f docker-compose.test.yml rm -f
