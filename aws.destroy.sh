#! /bin/bash

# exit on errors
set -euo pipefail

# import .env vars
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
	# should probably check for mandatory vars here
else
	echo "file .env not found. exiting"
	exit 1
fi

# for any relative paths
export script_dir=$(dirname "$(realpath $0)")
echo "script_dir=$script_dir" 2>&1 



echo "Destroy addon and service stacks..." 

function run_cdk() {
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

echo "Destroying addon stacks..."
plugins_checker=${PLUGINS:-}
if [[ -z $plugins_checker ]]; then
	echo "ERROR: PLUGINS=undefined."
	exit 1
else
	echo "PLUGINS=$PLUGINS" 
	IFS=',' read -ra plugin_names <<< "$PLUGINS"
	for plugin_name in "${plugin_names[@]}"; do
		plugin_name=$(echo "$plugin_name" | tr -d '[:space:]') # remove whitespace
		echo "Destroying addon stack: $plugin_name"
		run_cdk "$script_dir/addons/$plugin_name" "npx cdk destroy --force"
	done
fi

echo "Destroying shepherd-services stack..."
run_cdk "$script_dir/services-aws" "npx cdk destroy --force"

echo "Destroying shepherd-infra stack..."
run_cdk "$script_dir/infra" "npx cdk destroy --force"
