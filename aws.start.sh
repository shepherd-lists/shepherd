#!/bin/bash

# -= boilerplate =-

# exit on errors
set -euo pipefail

# for relative paths
script_dir=$(dirname "$(realpath $0)")
echo "script_dir=$script_dir" 

colour="\033[0;34m"
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
	export $(grep -Ev '^#' .env | xargs)
	# check for mandatory vars here
	if [[ -z $AWS_DEFAULT_REGION ]]; then
		echo "ERROR: missing mandatory environment variable, check .env.example, exiting"
		exit 1
	fi

	echo "WARNING!!! Might want to check for AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY missing issues!"

	if [[ -z $AWS_VPC_ID ]]; then
		echo "ERROR: missing previously created environment variable, did previous setup.sh script run OK? exiting"
		exit 1
	fi
	plugin_checker=${PLUGIN:-}
	if [[ -z $plugin_checker ]]; then
		echo "PLUGIN var not found. defaulting to 'nsfw'" 
		export PLUGIN=nsfw
	else
		echo "PLUGIN=$PLUGIN" 
	fi
	echo "Warning! ROUTETABLE, & SUBNETs 1/2/3 are not being created anymore" 

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
echo "RANGELIST_ALLOWED=${RANGELIST_ALLOWED:-}"

#################################################
# -= finally deploy all cdk stacks           =- #
#################################################

# function to save/cd/reset pwd when running cdk deploys
function cdk_deploy() {
	local target_dir="$1"
	local cdk_command="$2"
	# save pwd
	pwd=$(pwd)
	# cd to cdk dir
	cd "$target_dir"
	# run cdk command
	eval "$cdk_command"
	# cd back to original dir
	cd "$pwd"
}

echoHeading "Deploy shepherd-infra-stack..."
$script_dir/infra/setup.sh

echoHeading "Deploy shepherd-services core stack..."
$script_dir/services-aws/start.sh


## reimport .env to get new vars and deploy plugins
## this is just a hack for now. all of this bash scripting will likely be replaced.
export $(grep -Ev '^#' .env | xargs)
# check an example mandatory var here
if [[ -z $ShepherdCluster ]]; then
	echo "ERROR: missing generated environment variable, check .env and logs, exiting."
	exit 1
fi

# -= deploy plugins =-
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
		cdk_deploy "$script_dir/addons/$plugin_name" "npx cdk deploy --require-approval never"
	done
fi

echoHeading "Finished all deployments."

