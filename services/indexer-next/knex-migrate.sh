#!/bin/bash

if [ -z "$1" ] || [ -z "$DB_HOST" ]
	then
		echo "Usage: $0 <command> [migration_name]"
		echo "Ensure DB_HOST environment variable is set."
		exit 1
fi

node --import tsx ./node_modules/.bin/knex migrate:$1 $2
