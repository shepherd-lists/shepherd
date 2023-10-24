#!/bin/bash

docker compose -p shepherd-test -f docker-compose.test.yml build
docker compose -p shepherd-test -f docker-compose.test.yml up -d pgdb-test && sleep 1 # pgdb taking longer to be ready
docker compose -p shepherd-test -f docker-compose.test.yml run test npm run migrate
docker compose -p shepherd-test -f docker-compose.test.yml run test npm test
docker compose -p shepherd-test -f docker-compose.test.yml stop pgdb-test
docker compose -p shepherd-test -f docker-compose.test.yml down --remove-orphans
