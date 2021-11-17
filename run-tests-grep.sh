#!/bin/bash
echo "$1"
docker-compose -f docker-compose.test.yml build
docker-compose -f docker-compose.test.yml run test knex migrate:latest
docker-compose -f docker-compose.test.yml run test npm run test:grep "$1"
docker-compose -f docker-compose.test.yml down pgdb-test
docker-compose -f docker-compose.test.yml rm -f