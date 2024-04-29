#!/bin/bash

if [ -z "$1" ] 
	then
		echo "Usage: $0 <command> [migration_name]"
		exit 1
fi
if [ -z "$DB_HOST" ] 
	then
		echo "DB_HOST environment variable is not set (default localhost)."
fi

node --import tsx ./node_modules/.bin/knex migrate:$1 $2
