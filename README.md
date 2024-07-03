<img src="./docs/logo-github.png">

# shepherd

# PLEASE READ THIS FIRST. THIS DOCUMENTATION IS WILDLY OUT OF DATE. IF YOU NEED HELP SETTING UP, PLEASE CREATE AN ISSUE IN THIS GITHUB REPO.

## Overview

shepherd is a framework to build content moderation systems.

The output of shepherd is a transaction id list that you can read into whatever app/service you are using. There is also a machine readable list to use with an Arweave node, in order to protect your node from storing and serving unwanted material. Shepherd uses a simple plugin architecture so that you are in control of what is filtered, and makes creating your own filters easier through the use of these plugins.

> If you just want to use the default plugin, [skip on](#nsfw)

shepherd handles all of the raw content from the weave data, filters out non-media and most invalid data, and passes it on to your filter plugin.

If you decide to create a filter plugin you are not just limited to specific types of adult content (as with the default shepherd-plugin-nsfw), and could in fact filter anything you can build an AI classification filter for, or simpler filters such as blacklist/whitelist a particular app’s content media. It’s up to you as to whether you want to run it, and what you will filter.

## The shepherd plugin system

There are in fact 2 ways to add filters to shepherd, plugins and addons:

1. Basic: use the nsfw plugin harness system to load shepherd compatible plugins.
2. Advanced: create your own docker container to run an addon service. Documentation pending, but you read from remote/local SQS/S3, and write results to a http-api server. (FYI the "nsfw plugin harness" is actually an addon)

### <a name='config'></a>Basic Configuration

You can load plugins by adding them to `shepherd.config.json`. Currently just the first plugin in the list is used.

The default configuration:
```json
{
	"plugins": [
		"shepherd-plugin-nsfw@latest"
	],
	"lowmem": false
}
```
Shepherd plugins should be available as npmjs packages, or the build version made available on GitHub or elsewhere to install directly. Under the hood the system just runs 
`npm install <plugin-package>` 
and imports the module. So you can put whatever string you like in there. For example, if you wanted a certain branch from your GitHub repo 
`display-name/repo-name#branch-name`.

### shepherd-plugin-interfaces

Plugin filters need to conform to the [shepherd-plugin-interfaces](https://www.npmjs.com/package/shepherd-plugin-interfaces) in order to communicate with the shepherd host software.

Right now the interface is still settling, but this should be more or less it [shepherd-plugin-interfaces](services/src/common/shepherd-plugin-interfaces/index.ts)

### <a name='nsfw'></a> The Default Plugin: shepherd-plugin-nsfw

Using the default plugin creates & maintains a strict adult content blacklist.

Notes:

- Expect false positives. The aim is to have zero adult content get through.
- This is a work in progress. Bug reports appreciated :-) just open a [github issue](https://github.com/shepherd-media-classifier/shepherd-plugin-nsfw).

## Minimum System Requirements

- at least 100GB of free disk space
- windows: no specific requirements
- linux: swap file or partition must exist. Example: 32GB ram / 64GB swap
- apple silicon: default nsfw plugin still has issues
- other arm cpus or macos x86: untested, test reports welcome!

## Prerequisites

1. install docker
2. install docker-compose v2

## Install and run

1. Clone this repo and cd in to the `shepherd` directory. 
2. (optional/advanced) create a `.env` file (e.g. `cp .env.example .env`) and fill out your details
3. (optional) Configure `shepherd.config.json` if you need to
4. run this command:

```
docker-compose up -d
```
That's it! There's also `start.bat` and `./start.sh` for your convenience.

## Usage

### Initial Set Up

On initial start it will take some time (maybe several weeks for example) to read in and categorize all media files from the permaweb. Expect the server to run hot during this initial phase.

You can check on progress (and potentially errors) using `./logs.sh` or 
```
docker-compose logs -f
```
but there's no need to wait for it to sync to the latest block, you can start using the list produced straight away.

### Load and Use the Blacklist

Your new blacklist server will expose a list of blacklisted content on `http://localhost/blacklist.txt` or remotely by opening up port 80 and using your IP address.

You can use this in the CLI start command of your Arweave node by adding the `transaction_blacklist_url` parameter. For example, if your node & blacklist are running on the same server:
```
./bin/start mine mining_addr <YOUR-MINING-ADDRESS> transaction_blacklist_url http://localhost/blacklist.txt peer 188.166.200.45 peer 188.166.192.169 peer 163.47.11.64 peer 139.59.51.59 peer 138.197.232.192
```
See (shepherd-v.com)[http://shepherd-v.com] for more details.


### Final Thoughts

Your arweave node will automatically refresh and update blacklisted content as the list grows. There should be no more needed to be done. 

If you find that there are other tasks to be performed, please open a GitHub issue, thanks!

