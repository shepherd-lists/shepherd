#!/bin/bash

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
else
	echo "file .env not found. exiting"
	exit 1
fi

echo "Deleting cloudformation stack...(networks and RDS)" 2>&1 | tee -a setup.log
aws cloudformation delete-stack --stack-name shepherd-aws-stack

echo "Waiting for delete stack to complete..." 2>&1 | tee -a setup.log
aws cloudformation wait stack-delete-complete --stack-name shepherd-aws-stack

echo "Deleting ecr repositories..." 2>&1 | tee -a setup.log
aws ecr delete-repository --repository-name shepherd-webserver --force  2>&1 | tee -a setup.log
aws ecr delete-repository --repository-name shepherd-scanner --force    2>&1 | tee -a setup.log
aws ecr delete-repository --repository-name shepherd-rating --force     2>&1 | tee -a setup.log
aws ecr delete-repository --repository-name shepherd-http-api --force   2>&1 | tee -a setup.log

echo "Setting aws shepherd profile values to empty strings..." 2>&1 | tee -a setup.log
aws configure set profile.shepherd.region ""
aws configure set profile.shepherd.aws_access_key_id ""
aws configure set profile.shepherd.aws_secret_access_key ""