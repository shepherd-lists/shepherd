<img src="./logo-github.png">

# shepherd (BETA)

This server produces a blacklist that you can load in to an Arweave node, in order to protect it from storing and serving adult material.

It creates & maintains a strict adult content blacklist. This should be loaded by your Arweave node using the CLI parameter detailed below in the Usage section. Your node will refresh the list as it updates, automatically adding the new content to be blacklisted by your node.

>Notes: 
>- This is a work in progress. Bug reports appreciated :-) just open a github issue.
>- Expect false positives. The aim is to have zero adult content get through.

## BETA Version Software

This is marked as beta version software after the addition of one key feature, the ability to load your own `FilterPlugin`s. The purpose of shepherd is to become a framework to build better content moderation systems, but this is not just be limited to specific types of adult content (as with the default `shepherd-plugin-nsfw`), and could in fact be used to filter anything you can build an AI classification filter for, or simpler filters such as blacklist/whitelist a particular app's content media. It's up to you as to whether you want to run it, and what you will filter.

### shepherd-plugin-interfaces

These [here](blob/master/src/shepherd-plugin-interfaces/FilterPluginInterface.ts) are the interfaces your shepherd FilterPlugin should implement to commmunicate with the shepherd host software.

## Minimum System Requirements

- at least 10GB of free disk space
- windows: no specific requirements
- linux: swap file or partition must exist
- apple m1 silicon: cpu not yet supported
- other arm cpus or macos x86: untested, test reports welcome!

## Prerequisites

1. install docker & docker-compose

2. install nodejs (the version should not matter)

3. create a `.env` file and enter all required values (e.g. `cp .env.example .env`)

## Install and run

> Note well: Do **not** run 'npm install'

Clone this repo and cd in to the `shepherd` directory. Run this command

```
npm start
```
That's it!

## Usage

### Initial Set Up

On initial start it will take some time (maybe several days for example) to read in and categorize all media files from the permaweb. Expect the server to run hot during this initial phase.

You can check on progress using logs
```
npm run logs
```
but there's no need to wait for it to sync to the latest block, you can start using the list produced straight away.

### Load and Use the Blacklist

Your new blacklist server will expose a list of blacklisted content on the `/blacklist.txt` route. Either locally by `http://localhost/blacklist.txt` or remotely by IP address `http://<YOUR-IP-ADDRESS>/blacklist.txt`

You can use this in the CLI start command of your Arweave node by adding the `transaction_blacklist_url` parameter. For example, if your node & blacklist are running on the same server:
```
./bin/start mine mining_addr <YOUR-MINING-ADDRESS> transaction_blacklist_url http://localhost/blacklist.txt peer 188.166.200.45 peer 188.166.192.169 peer 163.47.11.64 peer 139.59.51.59 peer 138.197.232.192
```
otherwise you can add it via your blacklist server's IP address. 

### Final Thoughts

Your arweave node will automatically refresh and update blacklisted content as the list grows. There should be no more needed to be done. If you find that there are other tasks to be performed, please open a GitHub issue, thanks!
