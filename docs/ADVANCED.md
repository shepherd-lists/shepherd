<img src="./logo-github.png">

# shepherd advanced usage

> N.B. It is expected that you have already read the basic [README](./README.md).

The default configuration for shepherd loads your custom filters (specified in `shepherd.config.json`) as npm modules directly into the shepherd system. This behaviour is OK when the entire system is running on one machine, but what about cloud configurations?

## Cloud containers

Let's presume you want to load a horizontally scaling container to act as classifier on the addon inputs. There are two features already built into shepherd to accomodate this:

1. After data is fetched and pre-screened for validity, it's uploaded to a temporary S3 (`shepherd-input-s3-${aws-region}`) and a standard ObjectCreated message appears in shepherd2-input-q. Your container should use these to download the latest files.

2. A http API interface is provided for your containers to return results to. This service is unimaginatively called `http-api`.



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

There is support for running shepherd on AWS via AWS-CDK. 

First thing to do is create a config.dev.ts file by importing the Config.ts type from the project root, and fill in your details. See `/Config.ts` and `/config.example.ts` for reference.

- The `/cdk.launcher.ts` script must be run once WITH EMPTY `addons` IN CONFIG. This sets up an RDS database, networking, VPC, other microservices.  
- Addons should be added to the `/addons/` folder. the default "nsfw" will already be present.
- Again, after inital launcher run, add your addon names to the config.
