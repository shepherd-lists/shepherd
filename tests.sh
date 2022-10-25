#!/bin/bash

docker compose -p shepherd-test -f docker-compose.test.yml build
docker compose -p shepherd-test -f docker-compose.test.yml run test knex migrate:latest
docker compose -p shepherd-test -f docker-compose.test.yml run test npm test
docker compose -p shepherd-test -f docker-compose.test.yml stop pgdb-test
docker compose -p shepherd-test -f docker-compose.test.yml rm -f