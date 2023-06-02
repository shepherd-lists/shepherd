#!/bin/bash

# exit on errors
set -euo pipefail

# for any relative paths
export SCRIPT_DIR=$(dirname "$(realpath $0)")
echo "SCRIPT_DIR=$SCRIPT_DIR"

# check if `shepherd.config.json` exists, if not create default.
CONFIG_FILE="$SCRIPT_DIR/addons/nsfw/shepherd.config.json"
if [ ! -f "$CONFIG_FILE" ]; then
	echo "$CONFIG_FILE not found. creating default..." 2>&1 | tee -a setup.log
	cat <<EOF > "$CONFIG_FILE"
{
"plugins": [ 
	"shepherd-plugin-nsfw@latest"
],
"lowmem": false
}
EOF
fi

# import .env vars
if [ -f ".env.local" ]; then
	export $(egrep -v '^#' .env.local | xargs)
	# check vars
	EXTRA_QUEUES_CHECKER=${EXTRA_QUEUES:-}
	if [[ -z $EXTRA_QUEUES_CHECKER ]]; then
		echo "INFO: EXTRA_QUEUES undefined"
	else
		echo "EXTRA_QUEUES=$EXTRA_QUEUES"
	fi
		
	PLUGIN_CHECKER=${PLUGIN:-}
	if [[ -z $PLUGIN_CHECKER ]]; then
		echo "INFO: PLUGIN undefined"
		export PLUGIN=nsfw
	else
		echo "PLUGIN=$PLUGIN"
	fi
		
	echo "BLACKLIST_ALLOWED=$BLACKLIST_ALLOWED"
	echo "GW_URLS=$GW_URLS"


	# make sure .env ends in newline
	lastchar=$(tail -c 1 .env.local)
	if [ "$lastchar" != "" ]; then 
		echo >> .env
	fi
else
	echo "continuing without .env.local file."
fi

# import ..RANGELIST_ALLOWED.json as a string
if [ ! -f ".RANGELIST_ALLOWED.json" ]; then
	echo "WARNING: .RANGELIST_ALLOWED.json not found"
else
	export RANGELIST_ALLOWED=$(cat ./.RANGELIST_ALLOWED.json | tr -d ' \n\t')
fi
echo "RANGELIST_ALLOWED=$RANGELIST_ALLOWED"



docker compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.override.yml up --build -d 

docker compose -f $SCRIPT_DIR/docker-compose.yml -f $SCRIPT_DIR/docker-compose.override.yml logs -f
