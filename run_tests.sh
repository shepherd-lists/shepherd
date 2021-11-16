#!/bin/bash

docker-compose -f docker-compose.test.yml build
docker-compose -f docker-compose.test.yml run test knex migrate:latest
docker-compose -f docker-compose.test.yml run test npm test
docker-compose -f docker-compose.test.yml rm -f