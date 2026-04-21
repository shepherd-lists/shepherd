import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as path from 'path'
import { naming, finalQueueName, type Config } from '../../../../Config'
import { lokiLogDriver, lokiLogOpts } from '../../../../infra/components/lokiLogConfig'

export interface ServicesComponentArgs {
  config: Config
  stackName: string
  infraRef: pulumi.StackReference
  networkName: pulumi.Output<string>
}

export class ServicesComponent extends pulumi.ComponentResource {

  constructor(name: string, args: ServicesComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('shepherd:services:ServicesComponent', name, {}, opts)

    const childOpts = { ...opts, parent: this }
    const { config, stackName, infraRef, networkName } = args
    const n = (s: string) => naming(stackName, s)

    const postgresHost = infraRef.getOutput('postgresHost') as pulumi.Output<string>
    const minioEndpoint = infraRef.getOutput('minioEndpoint') as pulumi.Output<string>
    const sqsEndpoint = infraRef.getOutput('sqsEndpoint') as pulumi.Output<string>
    const redisHost = infraRef.getOutput('redisHost') as pulumi.Output<string>

    /** AWS SDK compatibility with MinIO/ElasticMQ */
    const awsCompat = pulumi.all([minioEndpoint, sqsEndpoint]).apply(([minio, sqs]) => [
      `AWS_ACCESS_KEY_ID=shepherd`,
      `AWS_SECRET_ACCESS_KEY=${config.minioPassword}`,
      `AWS_ENDPOINT_URL_S3=${minio}`,
      `AWS_ENDPOINT_URL_SQS=${sqs}`,
      `AWS_REGION=us-east-1`,
    ])

    /** common db + redis env vars */
    const storageEnvs = pulumi.all([postgresHost, redisHost]).apply(([pgHost, redis]) => [
      `DB_HOST=${pgHost}`,
      `DB_USER=shepherd`,
      `DB_PASSWORD=${config.dbPassword}`,
      `REDIS_HOST=${redis}`,
    ])

    // build the multi-stage Dockerfile once per service target
    const serviceDir = path.join(import.meta.dirname, '../../')
    const buildImage = (target: string) => new docker.Image(`image-${target}`, {
      build: {
        context: serviceDir,
        builderVersion: docker.BuilderVersion.BuilderBuildKit,
        platform: config.buildPlatform,
        target,
        args: { targetArg: target },
      },
      imageName: n(target),
      skipPush: true,
    }, childOpts)

    if (config.services.indexer) {
      const image = buildImage('indexer-next')
      new docker.Container('indexer-next', {
        name: n('indexer-next'),
        image: image.repoDigest,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([storageEnvs, awsCompat]).apply(([storage, aws]) => [
          ...storage,
          ...aws,
          ...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
          `HOST_URL=${config.host_url || 'https://arweave.net'}`,
          `GQL_URL=${config.gql_url || 'https://arweave.net/graphql'}`,
          `GQL_URL_SECONDARY=${config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql'}`,
          `LISTS_BUCKET=shepherd-lists`,
          `AWS_INPUT_BUCKET=shepherd-input`,
          `ingress_nodes=${JSON.stringify(config.ingress_nodes)}`,
          `http_api_nodes=${JSON.stringify(config.http_api_nodes)}`,
          `http_api_nodes_url=${config.http_api_nodes_url || ''}`,
        ]),
        logDriver: lokiLogDriver,
        logOpts: lokiLogOpts,
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    if (config.services.webserver) {
      const image = buildImage('webserver-next')
      new docker.Container('webserver-next', {
        name: n('webserver-next'),
        image: image.repoDigest,
        networksAdvanced: [{ name: networkName, aliases: ['webserver'] }],
        envs: pulumi.all([storageEnvs, awsCompat]).apply(([storage, aws]) => [
          ...storage,
          ...aws,
          ...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
          ...(config.slack_probe ? [`SLACK_PROBE=${config.slack_probe}`] : []),
          `HOST_URL=${config.host_url || 'https://arweave.net'}`,
          `GQL_URL=${config.gql_url || 'https://arweave.net/graphql'}`,
          `GQL_URL_SECONDARY=${config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql'}`,
          `LISTS_BUCKET=shepherd-lists`,
          `BLACKLIST_ALLOWED=${JSON.stringify(config.txids_whitelist) || ''}`,
          `RANGELIST_ALLOWED=${JSON.stringify(config.ranges_whitelist) || ''}`,
          `http_api_nodes=${JSON.stringify(config.http_api_nodes)}`,
          `http_api_nodes_url=${config.http_api_nodes_url || ''}`,
        ]),
        logDriver: lokiLogDriver,
        logOpts: lokiLogOpts,
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    if (config.services.httpApi) {
      const image = buildImage('http-api')
      const finalQueue = finalQueueName(config)
      const sqsSinkQueueEnv = finalQueue
        ? sqsEndpoint.apply(ep => `AWS_SQS_SINK_QUEUE=${ep}/000000000000/${finalQueue}`)
        : undefined

      new docker.Container('http-api', {
        name: n('http-api'),
        image: image.repoDigest,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([storageEnvs, awsCompat, sqsSinkQueueEnv ?? pulumi.output('')]).apply(([storage, aws, sinkQueue]) => [
          ...storage,
          ...aws,
          ...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
          ...(config.slack_positive ? [`SLACK_POSITIVE=${config.slack_positive}`] : []),
          `HOST_URL=${config.host_url || 'https://arweave.net'}`,
          `GQL_URL=${config.gql_url || 'https://arweave.net/graphql'}`,
          `GQL_URL_SECONDARY=${config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql'}`,
          `LISTS_BUCKET=shepherd-lists`,
          `AWS_INPUT_BUCKET=shepherd-input`,
          `http_api_nodes=${JSON.stringify(config.http_api_nodes)}`,
          `http_api_nodes_url=${config.http_api_nodes_url || ''}`,
          ...(sinkQueue ? [sinkQueue] : []),
        ]),
        logDriver: lokiLogDriver,
        logOpts: lokiLogOpts,
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    if (config.services.checks) {
      const image = buildImage('checks')
      new docker.Container('checks', {
        name: n('checks'),
        image: image.repoDigest,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([storageEnvs, awsCompat]).apply(([storage, aws]) => [
          ...storage,
          ...aws,
          ...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
          ...(config.slack_probe ? [`SLACK_PROBE=${config.slack_probe}`] : []),
          ...(config.pagerduty_key ? [`PAGERDUTY_KEY=${config.pagerduty_key}`] : []),
          `LISTS_BUCKET=shepherd-lists`,
          `BLACKLIST_ALLOWED=${JSON.stringify(config.txids_whitelist) || ''}`,
          `RANGELIST_ALLOWED=${JSON.stringify(config.ranges_whitelist) || ''}`,
          `GW_DOMAINS=${JSON.stringify(config.gw_domains) || ''}`,
          `http_api_nodes_url=${config.http_api_nodes_url || ''}`,
        ]),
        logDriver: lokiLogDriver,
        logOpts: lokiLogOpts,
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    this.registerOutputs({})
  }
}
