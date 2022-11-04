#!/bin/bash

# exit on errors
set -euo pipefail

# import .env vars
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# check vars
	echo "EXTRA_QUEUES=$EXTRA_QUEUES"
	echo "PLUGIN=$PLUGIN"
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