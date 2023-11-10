#!/bin/bash

# -= boilerplate =-

# exit on errors
set -euo pipefail

# for relative paths
script_dir=$(dirname "$(realpath $0)")
echo "script_dir=$script_dir" 

colour="\033[30;43m"
reset="\033[0m"
function echoHeading() {
	echo -e "${colour}$1${reset}"
}

# -= ensure `shepherd.config.json` exists =-

config_file="$script_dir/addons/nsfw/shepherd.config.json"
if [ ! -f "$config_file" ]; then
  echo "$config_file not found. creating default..." 
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
	# make sure .env ends in newline
	lastchar=$(tail -c 1 .env)
	if [ "$lastchar" != "" ]; then 
		echo >> .env
	fi

	# import .env vars
	export $(grep -Ev '^#' .env | xargs)
	# check for mandatory vars here
	if [[ -z $AWS_DEFAULT_REGION ]]; then
		echo "ERROR: missing mandatory environment variable, check .env.example, exiting"
		exit 1
	fi

	plugin_checker=${PLUGIN:-}
	if [[ -z $plugin_checker ]]; then
		echo "PLUGINS var not found. defaulting to 'nsfw'" 
		export PLUGINS=nsfw
	else
		echo "PLUGINS=$PLUGINS" 
	fi


else
	echo "file .env not found. exiting"
	exit 1
fi

# if there's one env var we need it's the region
if [[ -z $AWS_DEFAULT_REGION ]]; then
	echo "ERROR: missing mandatory environment variable AWS_DEFAULT_REGION, exiting."
	exit 1
fi

# hack needed for aws-sdk 
export AWS_REGION=$AWS_DEFAULT_REGION

# import .RANGELIST_ALLOWED.json as a string

if [ ! -f ".RANGELIST_ALLOWED.json" ]; then
	echo "WARNING: .RANGELIST_ALLOWED.json not found"
else
	export RANGELIST_ALLOWED=$(cat ./.RANGELIST_ALLOWED.json | tr -d ' \n\t')
fi
echo "RANGELIST_ALLOWED=${RANGELIST_ALLOWED:-}"

#################################################
# -= finally deploy all cdk stacks           =- #
#################################################

# function to save/cd/reset pwd when running cdk deploys
function run_cdk() {
	local target_dir="$1"
	local change_name=$(basename "$target_dir")
	# save pwd
	pwd=$(pwd)
	# cd to cdk dir
	cd "$target_dir"
	# run cdk command
	npx cdk deploy --require-approval never --output="./cdk.out.$AWS_DEFAULT_REGION" --change-set-name "$change_name-$AWS_DEFAULT_REGION"
	# cd back to original dir
	cd "$pwd"
}

echoHeading "Deploy shepherd-infra-stack..."
run_cdk "$script_dir/infra" 

echoHeading "Deploy shepherd-services core stack..."
run_cdk "$script_dir/services-aws"


echoHeading "Deploying plugins..."
# loop through PLUGINS and deploy them

plugins_checker=${PLUGINS:-}
if [[ -z $plugins_checker ]]; then
	echo "ERROR: PLUGINS=undefined."
	exit 1
else
	echo "PLUGINS=$PLUGINS" 
	IFS=',' read -ra plugin_names <<< "$PLUGINS"
	for plugin_name in "${plugin_names[@]}"; do
		plugin_name=$(echo "$plugin_name" | tr -d '[:space:]') # remove whitespace
		echoHeading "Deploying $plugin_name..."
		run_cdk "$script_dir/addons/$plugin_name"
	done
fi

echoHeading "Finished all deployments."

