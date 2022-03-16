<img src="./logo-github.png">

# shepherd advanced usage

> N.B. It is expected that you have already read the basic [README](./README.md).

The default configuration for shepherd loads your custom filters (specified in `shepherd.config.json`) as npm modules directly into the shepherd system. This behaviour is OK when the entire system is running on one machine, but what about cloud configurations?

## Cloud containers

Let's presume you want to load a horizontally scaling container to act as classifier on the plugin inputs. There are two features already built into shepherd to accomodate this:

1. Use of a special 'noop' return type from shepherd-plugin-interfaces check function. This allows shepherd to continue feeding file data to your plugin while marking it internally as "in-flight".

2. Provision of a http API interface for your containers to return results to. This service is unimaginatively called `http-api`.


### 1. Stub Plugin

Example code for a stub plugin can be seen here: [container-stub-plugin-example](https://github.com/shepherd-media-classifier/container-stub-plugin-example/blob/main/src/index.ts). It's commented and self explanatory.

### 2. HTTP-API interface

As previously mentioned in the README with PlugIns, the interface types for http-api are located in `shepherd-plugin-interfaces`. The http-api expects an `APIFilterResult` as payload, and runs on port `84`.

Example, writing a file's result to the http-api:

```ts
const payload: APIFilterResult = {
	txid,
	result: {
		flagged: true
	}
}

const res = await axios.post('http://http-api.shepherd.local:84/postupdate', payload)
```

For reference, the code for the http-api is located in [./apps/src/http-api/index.ts](./apps/src/http-api/index.ts)

### AWS Infra Support

Step 1 is to copy `.env.aws.example` to `.env`, and fill in your details.

There is support for running shepherd on AWS ECS using Docker and CloudFormation templates. More details can be found in the `./infra/` folder. The `./infra/setup.sh` script must be run first. The AWS regional instance can then be spun up using the `./ecs.sh` script.

The `./infra/setup.sh` exports variables such as 'AWS_VPC_ID', and 'AWS_SECURITY_GROUP_ID' and *also* appends them to your `.env` file. These can be used to add your containers to the shepherd VPC. 

See `docker-compose.aws.yml`, `./ecs.sh`, and `./infra/setup.sh` for example usage.


## Notes

The cloud scaling feature is under current development for performance optimizations. ***There will be no changes to the exposed interfaces***, but it is advised to keep up to date with the latest shepherd master, by running `git pull` in the build repo folder.