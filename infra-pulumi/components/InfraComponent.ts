import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as minio from '@pulumi/minio'
import * as path from 'path'
import type { Config } from '../../Config'
import { generateElasticMqConfig } from '../elasticmq/generate-config'

export interface InfraComponentArgs {
  config: Config
  network: docker.Network
  dbPassword: pulumi.Output<string>
  minioPassword: pulumi.Output<string>
  repoPath?: string
  stackName: string
}

export class InfraComponent extends pulumi.ComponentResource {
  public readonly network: docker.Network
  public readonly postgresHost: string
  public readonly minioEndpoint: string
  public readonly sqsEndpoint: string

  constructor(name: string, args: InfraComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('shepherd:infra:InfraComponent', name, {}, opts)

    const childOpts = { ...opts, parent: this }
    const { network, dbPassword, minioPassword, stackName } = args
    const n = (s: string) => `${s}-shep-${stackName}`
    if (!args.repoPath) {
      throw new Error('config.repoPath is required')
    }

    const elasticMqConfPath = path.join(args.repoPath, 'infra-pulumi/elasticmq/elasticmq.conf')
    generateElasticMqConfig(args.config, elasticMqConfPath)

    const pgVolume = new docker.Volume('pg-data', { name: n('pg-data') }, childOpts)
    const minioVolume = new docker.Volume('minio-data', { name: n('minio-data') }, childOpts)
    const elasticMqVolume = new docker.Volume('elasticmq-data', { name: n('elasticmq-data') }, childOpts)

    new docker.Container('postgres', {
      name: n('postgres'),
      image: 'postgres:18',
      networksAdvanced: [{ name: network.name }],
      envs: [
        'POSTGRES_USER=shepherd',
        pulumi.interpolate`POSTGRES_PASSWORD=${dbPassword}`,
        'POSTGRES_DB=arblacklist',
      ],
      volumes: [{ volumeName: pgVolume.name, containerPath: '/var/lib/postgresql' }],
      restart: 'unless-stopped',
    }, childOpts)

    const minioContainer = new docker.Container('minio', {
      name: n('minio'),
      image: 'minio/minio',
      networksAdvanced: [{ name: network.name }],
      envs: [
        'MINIO_ROOT_USER=shepherd',
        pulumi.interpolate`MINIO_ROOT_PASSWORD=${minioPassword}`,
      ],
      volumes: [{ volumeName: minioVolume.name, containerPath: '/data' }],
      command: ['server', '/data', '--console-address', ':9001'],
      ports: [
        { internal: 9000, external: 9000 },  // API
        { internal: 9001, external: 9001 },  // UI
      ],
      restart: 'unless-stopped',
    }, childOpts)

    const minioProvider = new minio.Provider('minio', {
      minioServer: 'localhost:9000',
      minioUser: 'shepherd',
      minioPassword: minioPassword,
      minioSsl: false,
    }, { ...childOpts, dependsOn: [minioContainer] })

    const minioProviderOpts = { ...childOpts, provider: minioProvider, dependsOn: [minioContainer] }

    const inputBucket = new minio.S3Bucket('shepherd-input', { bucket: 'shepherd-input' }, minioProviderOpts)
    const listsBucket = new minio.S3Bucket('shepherd-lists', { bucket: 'shepherd-lists' }, minioProviderOpts)

    // allow public read on shepherd-lists (nodes download blacklists)
    new minio.S3BucketPolicy('shepherd-lists-policy', {
      bucket: listsBucket.bucket,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::shepherd-lists/*`],
        }],
      }),
    }, minioProviderOpts)

    const elasticmqContainer = new docker.Container('elasticmq', {
      name: n('elasticmq'),
      image: 'softwaremill/elasticmq-native',
      networksAdvanced: [{ name: network.name }],
      volumes: [
        { volumeName: elasticMqVolume.name, containerPath: '/data' },
        { hostPath: elasticMqConfPath, containerPath: '/opt/elasticmq.conf', readOnly: true },
      ],
      command: ['-Dconfig.file=/opt/elasticmq.conf'],
      labels: [{ label: 'shepherd.classifiers', value: args.config.classifiers.join(',') }],
      ports: [
        { internal: 9324, external: 9324 },  // SQS API
        { internal: 9325, external: 9325 },  // UI
      ],
      restart: 'unless-stopped',
    }, childOpts)

    const minio2mqImage = new docker.Image('minio2mq', {
      build: {
        context: path.join(args.repoPath, 'infra-pulumi/minio2mq'),
        builderVersion: docker.BuilderVersion.BuilderV1,
      },
      imageName: n('minio2mq'),
      skipPush: true,
    }, childOpts)

    new docker.Container('minio2mq', {
      name: n('minio2mq'),
      image: minio2mqImage.imageName,
      networksAdvanced: [{ name: network.name }],
      envs: pulumi.all([minioPassword]).apply(([minioPw]) => [
        `MINIO_ENDPOINT=${n('minio')}`,
        `MINIO_ACCESS_KEY=shepherd`,
        `MINIO_SECRET_KEY=${minioPw}`,
        `MINIO_BUCKET=shepherd-input`,
        `SQS_ENDPOINT=http://${n('elasticmq')}:9324`,
        `SQS_QUEUE_URL=http://${n('elasticmq')}:9324/000000000000/shepherd2-input-q`,
        ...(args.config.slack_webhook ? [`SLACK_WEBHOOK=${args.config.slack_webhook}`] : []),
      ]),
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [minio2mqImage, minioContainer, inputBucket, elasticmqContainer] })

    new docker.Container('nginx', {
      name: n('nginx'),
      image: 'nginx:alpine',
      networksAdvanced: [{ name: network.name }],
      ports: [
        { internal: 80, external: 80 },
        { internal: 443, external: 443 },
      ],
      volumes: [{ hostPath: `${args.repoPath}/infra-pulumi/nginx/nginx.conf`, containerPath: '/etc/nginx/nginx.conf', readOnly: true }],
      restart: 'unless-stopped',
    }, childOpts)

    this.network = network
    this.postgresHost = n('postgres')
    this.minioEndpoint = `http://${n('minio')}:9000`
    this.sqsEndpoint = `http://${n('elasticmq')}:9324`

    this.registerOutputs({
      postgresHost: this.postgresHost,
      minioEndpoint: this.minioEndpoint,
      sqsEndpoint: this.sqsEndpoint,
    })
  }
}
