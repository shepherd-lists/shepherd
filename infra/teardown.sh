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

echo "Deleting all objects from $AWS_INPUT_BUCKET..."

aws s3 rm "s3://$AWS_INPUT_BUCKET/" --recursive 

## unfinished. should be faster to get list and batch into 1000 objects, then use delete-objects command on 1000 object batches
# aws s3api list-objects --bucket "$AWS_INPUT_BUCKET"
# aws s3api delete-objects --bucket $AWS_INPUT_BUCKET --delete $()

echo "Deleting cloudformation stack...(networks and RDS)" 2>&1 | tee -a setup.log
aws cloudformation delete-stack --stack-name shepherd-aws-stack

echo "Waiting for delete stack to complete..." 2>&1 | tee -a setup.log
aws cloudformation wait stack-delete-complete --stack-name shepherd-aws-stack 2>&1 | tee -a setup.log

echo "Deleting ecr repositories..." 2>&1 | tee -a setup.log
aws ecr delete-repository --repository-name shepherd --force  2>&1 | tee -a setup.log

## older repos. just use one now.
# aws ecr delete-repository --repository-name shepherd-webserver --force  2>&1 | tee -a setup.log
# aws ecr delete-repository --repository-name shepherd-scanner --force    2>&1 | tee -a setup.log
# aws ecr delete-repository --repository-name shepherd-rating --force     2>&1 | tee -a setup.log
# aws ecr delete-repository --repository-name shepherd-http-api --force   2>&1 | tee -a setup.log
# aws ecr delete-repository --repository-name shepherd-feeder --force   2>&1 | tee -a setup.log
# aws ecr delete-repository --repository-name shepherd-fetchers --force   2>&1 | tee -a setup.log
