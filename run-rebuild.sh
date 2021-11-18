#!/bin/bash
docker-compose down --remove-orphans
docker-compose up --build -d && docker-compose logs -f