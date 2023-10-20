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

echo "Destroying infra stack..."

# save dir
current_dir="$(pwd)"
# run cdk
script_dir=$(dirname "$(realpath $0)")
cd "$script_dir"
npx -y cdk destroy --force
# restore dir
cd "$current_dir"
