#!/bin/bash

# -= boilerplate =-

# exit on errors
set -euo pipefail

# for relative paths
script_dir=$(dirname "$(realpath $0)")
echo "script_dir=$script_dir" 2>&1 | tee -a setup.log

# -= ensure `shepherd.config.json` exists =-

config_file="$script_dir/addons/nsfw/shepherd.config.json"
if [ ! -f "$config_file" ]; then
  echo "$config_file not found. creating default..." 2>&1 | tee -a setup.log
  cat <<EOF > "$config_file"
{
"plugins": [ 
  "shepherd-plugin-nsfw@latest"
],
"lowmem": false
}
EOF
fi

# -= import .env vars =-

if [ -f ".env" ]; then
	export $(grep -Ev '^#' .env | xargs)
	# check for mandatory vars here
	if [[ -z $AWS_DEFAULT_REGION || -z $AWS_ACCESS_KEY_ID || -z $AWS_SECRET_ACCESS_KEY ]]; then
		echo "ERROR: missing mandatory environment variable, check .env.example, exiting"
		exit 1
	fi
	if [[ -z $ROUTETABLE || -z $AWS_VPC_ID ]]; then
		echo "ERROR: missing previously created environment variable, did previous setup.sh script run OK? exiting"
		exit 1
	fi
	plugin_checker=${PLUGIN:-}
	if [[ -z $plugin_checker ]]; then
		echo "PLUGIN var not found. defaulting to 'nsfw'" 2>&1 | tee -a setup.log
		export PLUGIN=nsfw
	else
		echo "PLUGIN=$PLUGIN" 2>&1 | tee -a setup.log
	fi

	# make sure .env ends in newline
	lastchar=$(tail -c 1 .env)
	if [ "$lastchar" != "" ]; then 
		echo >> .env
	fi
else
	echo "file .env not found. exiting"
	exit 1
fi

# import .RANGELIST_ALLOWED.json as a string

if [ ! -f ".RANGELIST_ALLOWED.json" ]; then
	echo "WARNING: .RANGELIST_ALLOWED.json not found"
else
	export RANGELIST_ALLOWED=$(cat ./.RANGELIST_ALLOWED.json | tr -d ' \n\t')
fi
echo "RANGELIST_ALLOWED=$RANGELIST_ALLOWED"

#################################################
# -= finally run docker setup & run commands =- #
#################################################

# -= setup docker ecs context =-

echo "Remove existing docker ecs context..."
docker context rm ecs 2>&1 | tee -a setup.log

echo "Creating docker ecs context ..."
docker context create ecs ecs --from-env  2>&1 | tee -a setup.log

export IMAGE_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
echo "$IMAGE_REPO"  2>&1 | tee -a setup.log

echo "Docker login ecr..."
# docker logout
aws ecr get-login-password | docker login --password-stdin --username AWS $IMAGE_REPO

# -= add compose files to the command args =-

compose_file_args=" \
  -f $script_dir/docker-compose.yml \
  -f $script_dir/docker-compose.aws.yml \
  -f $script_dir/addons/$PLUGIN/docker-compose.aws.yml"

plugins_checker=${PLUGINS:-}
if [[ -z $plugins_checker ]]; then
	echo "Info: PLUGINS=undefined." 2>&1 | tee -a setup.log
else
	echo "PLUGINS=$PLUGINS" 2>&1 | tee -a setup.log
	IFS=',' read -ra plugin_names <<< "$PLUGINS"
	for plugin_name in "${plugin_names[@]}"; do
		plugin_name=$(echo "$plugin_name" | tr -d '[:space:]') # remove whitespace
		compose_file_args="$compose_file_args -f $script_dir/addons/$plugin_name/docker-compose.aws.yml"
	done
fi

cmd_docker_compose="docker compose $compose_file_args"
echo "cmd_docker_compose=$cmd_docker_compose" 2>&1 | tee -a setup.log

echo "Docker build..." 2>&1 | tee -a setup.log
eval "$cmd_docker_compose build"

echo "Docker push..."  2>&1 | tee -a setup.log
# prime the docker caches first. indexer has no dependencies
eval "$cmd_docker_compose push indexer"
eval "$cmd_docker_compose push"

cmd_docker_compose_ecs="docker --context ecs compose $compose_file_args"

echo "Docker convert..." 2>&1 | tee -a setup.log
eval "$cmd_docker_compose_ecs convert" > "cfn.yml.$(date +"%Y.%m.%d-%H:%M").log"

echo "Docker up..." 2>&1 | tee -a setup.log
# do `docker --debug` if you want extra info
eval "$cmd_docker_compose_ecs up"

echo "Docker ps..." 2>&1 | tee -a setup.log
eval "$cmd_docker_compose_ecs ps"

