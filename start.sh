#!/bin/bash

# exit on errors
set -eo pipefail

# import .env vars
if [ -f ".env.local" ]; then
	export $(egrep -v '^#' .env.local | xargs)
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
	lastchar=$(tail -c 1 .env.local)
	if [ "$lastchar" != "" ]; then 
		echo >> .env
	fi
else
	echo "continuing without .env.local file."
fi
# for any relative paths
export SCRIPT_DIR=$(dirname "$(realpath $0)")
echo "SCRIPT_DIR=$SCRIPT_DIR"


docker compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.override.yml up --build -d 

docker compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.override.yml logs -f
