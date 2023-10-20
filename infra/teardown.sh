#!/bin/bash

# exit on errors
set -euo pipefail

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
else
	echo "file .env not found. exiting"
	exit 1
fi

echo "Deleting cloudformation stack...(networks and RDS)"

# save dir
current_dir="$(pwd)"
# run cdk
script_dir=$(dirname "$(realpath $0)")
cd "$script_dir"
npx -y cdk destroy --force
# restore dir
cd "$current_dir"


echo "Deleting ecr repositories..." 2>&1 | tee -a setup.log
aws ecr delete-repository --repository-name shepherd --force

