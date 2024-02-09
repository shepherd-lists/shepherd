#!/bin/bash

if [ -z "$1" ]
	then
		echo "Usage: $0 <migration_name>"
		exit 1
fi

node --import tsx ./node_modules/.bin/knex migrate:make $1
