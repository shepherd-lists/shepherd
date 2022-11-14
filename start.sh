#!/bin/bash

# exit on errors
set -eo pipefail

# import .env vars
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# check vars
	if [[ -z $EXTRA_QUEUES ]]; then
		echo "INFO: EXTRA_QUEUES undefined"
	else
		echo "EXTRA_QUEUES=$EXTRA_QUEUES"
	fi
		
	echo "PLUGIN=$PLUGIN"
	echo "BLACKLIST_ALLOWED=$BLACKLIST_ALLOWED"
	echo "RANGELIST_ALLOWED=$RANGELIST_ALLOWED"
	echo "GW_URLS=$GW_URLS"
	if [[ -z $PLUGIN || -z $EXTRA_QUEUES ]]; then
		echo "INFO: some environment variables not set, using defaults. check .env.example"
	fi

	# make sure .env ends in newline
	lastchar=$(tail -c 1 .env)
	if [ "$lastchar" != "" ]; then 
		echo >> .env
	fi
else
	echo "continuing without .env file."
fi


docker compose up --build -d && docker compose logs -f
