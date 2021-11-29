#!/bin/bash

# import .env
if [ -f ".env" ]; then
	export $(egrep -v '^#' .env | xargs)
else
	echo "file .env not found. exiting"
	exit 1
fi

echo "Deleting RDS pgdb..." 2>&1 | tee -a setup.log
aws cloudformation delete-stack --stack-name shepherd-rds-stack

echo "Deleting networks stack..." 2>&1 | tee -a setup.log
aws cloudformation delete-stack --stack-name shepherd-networks-stack

echo "Deleting SG $AWS_SECURITY_GROUP_ID ..." 2>&1 | tee -a setup.log
aws ec2 revoke-security-group-ingress --region $AWS_REGION --group-id $AWS_SECURITY_GROUP_ID --protocol tcp --port 5432 --source-group $AWS_SECURITY_GROUP_ID
aws ec2 delete-security-group --region $AWS_REGION --group-id $AWS_SECURITY_GROUP_ID

echo "Deleting ecr repositories..." 2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-webserver --force  2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-scanner --force    2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-rating --force     2>&1 | tee -a setup.log
aws ecr delete-repository --region $AWS_REGION --repository-name shepherd-http-api --force   2>&1 | tee -a setup.log

