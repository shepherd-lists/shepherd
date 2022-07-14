#!/bin/bash
echo "$1"
docker-compose -p shepherd-test -f docker-compose.test.yml rm -f
docker-compose -p shepherd-test -f docker-compose.test.yml build
docker-compose -p shepherd-test -f docker-compose.test.yml run test knex migrate:latest
docker-compose -p shepherd-test -f docker-compose.test.yml up -d s3-local-test && (docker compose logs -f s3-local-test &)
docker-compose -p shepherd-test -f docker-compose.test.yml run test npm run test:grep "$1"
docker-compose -p shepherd-test -f docker-compose.test.yml down pgdb-test
docker-compose -p shepherd-test -f docker-compose.test.yml rm -f