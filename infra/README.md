# Build notes for AWS

## This is step one for AWS setup, to be done before invoking docker-compose

- install aws-cli v2
- set up a .env file with your AWS credentials and region, as in .env.aws.example
- run `setup.sh` to install supporting AWS infrastrucure & database
- finally run `ecs.sh` in the root folder to install the app servers via docker-compose

### MacOS

- install brew
- `brew install coreutils`
- `brew install gnu-sed` and follow directions to install to path.
- (optional) `brew install bash` and chsh to new install