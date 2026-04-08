import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as path from 'path'
import { naming, finalQueueName, type Config } from '../../../../Config'

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

    // shared env vars for AWS SDK compatibility with MinIO/ElasticMQ
    const awsCompatEnvs = pulumi.all([minioEndpoint, sqsEndpoint]).apply(([minio, sqs]) => [
      `AWS_ACCESS_KEY_ID=shepherd`,
      `AWS_SECRET_ACCESS_KEY=${config.minioPassword}`,
      `AWS_ENDPOINT_URL_S3=${minio}`,
      `AWS_ENDPOINT_URL_SQS=${sqs}`,
      `AWS_REGION=us-east-1`,
    ])

    // shared env vars from config
    const configEnvs = [
      ...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
      ...(config.slack_positive ? [`SLACK_POSITIVE=${config.slack_positive}`] : []),
      ...(config.slack_probe ? [`SLACK_PROBE=${config.slack_probe}`] : []),
      `HOST_URL=${config.host_url || 'https://arweave.net'}`,
      `GQL_URL=${config.gql_url || 'https://arweave.net/graphql'}`,
      `GQL_URL_SECONDARY=${config.gql_url_secondary || 'https://arweave-search.goldsky.com/graphql'}`,
      `LISTS_BUCKET=shepherd-lists`,
      `AWS_INPUT_BUCKET=shepherd-input`,
      `http_api_nodes=${JSON.stringify(config.http_api_nodes)}`,
      `http_api_nodes_url=${config.http_api_nodes_url || ''}`,
      `ingress_nodes=${JSON.stringify(config.ingress_nodes)}`,
    ]

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

    // SQS sink queue URL for http-api (last classifier output queue)
    const finalQueue = finalQueueName(config)
    const sqsSinkQueueEnv = finalQueue
      ? sqsEndpoint.apply(ep => `AWS_SQS_SINK_QUEUE=${ep}/000000000000/${finalQueue}`)
      : undefined

    if (config.services.indexer) {
      const image = buildImage('indexer-next')
      new docker.Container('indexer-next', {
        name: n('indexer-next'),
        image: image.imageName,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([postgresHost, awsCompatEnvs]).apply(([dbHost, awsEnvs]) => [
          `DB_HOST=${dbHost}`,
          ...awsEnvs,
          ...configEnvs,
        ]),
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    if (config.services.webserver) {
      const image = buildImage('webserver-next')
      new docker.Container('webserver-next', {
        name: n('webserver-next'),
        image: image.imageName,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([postgresHost, awsCompatEnvs]).apply(([dbHost, awsEnvs]) => [
          `DB_HOST=${dbHost}`,
          ...awsEnvs,
          ...configEnvs,
          `BLACKLIST_ALLOWED=${JSON.stringify(config.txids_whitelist) || ''}`,
          `RANGELIST_ALLOWED=${JSON.stringify(config.ranges_whitelist) || ''}`,
        ]),
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    if (config.services.httpApi) {
      const image = buildImage('http-api')
      new docker.Container('http-api', {
        name: n('http-api'),
        image: image.imageName,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([postgresHost, awsCompatEnvs, sqsSinkQueueEnv ?? pulumi.output('')]).apply(([dbHost, awsEnvs, sinkQueue]) => [
          `DB_HOST=${dbHost}`,
          ...awsEnvs,
          ...configEnvs,
          ...(sinkQueue ? [sinkQueue] : []),
        ]),
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    if (config.services.checks) {
      const image = buildImage('checks')
      new docker.Container('checks', {
        name: n('checks'),
        image: image.imageName,
        networksAdvanced: [{ name: networkName }],
        envs: pulumi.all([postgresHost, awsCompatEnvs]).apply(([dbHost, awsEnvs]) => [
          `DB_HOST=${dbHost}`,
          ...awsEnvs,
          ...configEnvs,
          `BLACKLIST_ALLOWED=${JSON.stringify(config.txids_whitelist) || ''}`,
          `RANGELIST_ALLOWED=${JSON.stringify(config.ranges_whitelist) || ''}`,
          `GW_DOMAINS=${JSON.stringify(config.gw_domains) || ''}`,
        ]),
        restart: 'unless-stopped',
      }, { ...childOpts, dependsOn: [image] })
    }

    this.registerOutputs({})
  }
}
