#!/bin/bash

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
else
	echo "file .env not found. exiting"
	exit 1
fi

echo "Deleting cloudformation stack...(networks and RDS)" 2>&1 | tee -a setup.log
aws cloudformation delete-stack --region $AWS_REGION --stack-name shepherd-aws-stack


echo "Deleting ecr repositories..." 2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-webserver --force  2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-scanner --force    2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-rating --force     2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-http-api --force   2>&1 | tee -a setup.log

