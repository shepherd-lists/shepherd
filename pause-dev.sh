#!/bin/bash

# Check if a region was specified, if not use the default from environment
if [ $# -ne 1 ]; then
	echo "Usage: $0 <aws-region>. No regtion specified, defaulting."
	export AWS_DEFAULT_REGION=$(aws configure get region)
else
	export AWS_DEFAULT_REGION=$1
fi

# Confirm with the user that they want to pause the services
echo
read -p "Pause rds & services in \"$AWS_DEFAULT_REGION\". Are you sure? (y/n)" choice
while [[ ! "$choice" =~ ^[yYnN]$ ]]; do
    read -p "Please enter y or n: " choice
done
if [[ "$choice" =~ ^[nN]$ ]]; then
    echo "Aborting..."
    exit 1
fi

# Function to check the status of each background process
check_status() {
	local status=$1
	local service=$2
	if [ $1 -ne 0 ]; then
		echo "Stopping $service failed with status $1"
	fi
}

# Set constants
RDS_INSTANCE_IDENTIFIER="shepherd2-pgdb"
ECS_CLUSTER_NAME="shepherd-services"

# Stop the RDS instance and update the ECS service in the background
echo "Stopping RDS instance: $RDS_INSTANCE_IDENTIFIER"
aws rds stop-db-instance --db-instance-identifier "$RDS_INSTANCE_IDENTIFIER" &
pid_rds=$!

stop_service() {
	local service=$1
	echo "Stopping ECS service $service"
	aws ecs update-service --cluster $ECS_CLUSTER_NAME --service $service --desired-count 0 > /dev/null 2>&1
	return $?
}

stop_service 'feeder' &
pid_feeder=$!
stop_service 'fetchers' &
pid_fetchers=$!
stop_service 'indexer' &
pid_indexer=$!
stop_service 'http-api' &
pid_http_api=$!
stop_service 'webserver' &

# Wait for both commands to finish and capture their exit statuses
wait $pid_rds
status_rds=$?
wait $pid_feeder
status_feeder=$?
wait $pid_fetchers
status_fetchers=$?
wait $pid_indexer
status_indexer=$?
wait $pid_http_api
status_http_api=$?
wait $pid_webserver
status_webserver=$?

# Check the status of each command
check_status $status_rds 'rds'
check_status $status_feeder 'feeder'
check_status $status_fetchers 'fetchers'
check_status $status_indexer 'indexer'
check_status $status_http_api 'http-api'
check_status $status_webserver 'webserver'

echo "Pausing actions complete, check for errors above."
