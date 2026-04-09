import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as path from 'path'
import { naming, type Config } from '../../Config'
import { generateElasticMqConfigString } from '../elasticmq/generate-config'

export interface InfraComponentArgs {
  config: Config
  network: docker.Network
  stackName: string
}

export class InfraComponent extends pulumi.ComponentResource {
  public readonly network: docker.Network
  public readonly postgresHost: string
  public readonly minioEndpoint: string
  public readonly sqsEndpoint: string
  public readonly redisHost: string

  constructor(name: string, args: InfraComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('shepherd:infra:InfraComponent', name, {}, opts)

    const childOpts = { ...opts, parent: this }
    const { config, network, stackName } = args
    const n = (s: string) => naming(stackName, s)

    const pgVolume = new docker.Volume('pg-data', { name: n('pg-data') }, childOpts)
    const minioVolume = new docker.Volume('minio-data', { name: n('minio-data') }, childOpts)
    const elasticMqVolume = new docker.Volume('elasticmq-data', { name: n('elasticmq-data') }, childOpts)
    const configVolume = new docker.Volume('config', { name: n('config') }, childOpts)

    // write elasticmq.conf into shared config volume via one-shot alpine container
    const elasticMqConf = generateElasticMqConfigString(config)
    const elasticMqConfContainer = new docker.Container('elasticmq-config', {
      name: n('elasticmq-config'),
      image: 'alpine:3', //might want to pin this further?
      volumes: [{ volumeName: configVolume.name, containerPath: '/config' }],
      command: ['sh', '-c', `cat > /config/elasticmq.conf << 'EOF'\n${elasticMqConf}EOF`],
      labels: [{ label: 'shepherd.classifiers', value: config.classifiers.join(',') }],
      mustRun: false,
    }, childOpts)

    new docker.Container('postgres', {
      name: n('postgres'),
      image: 'postgres:18',
      networksAdvanced: [{ name: network.name }],
      envs: [
        'POSTGRES_USER=shepherd',
        `POSTGRES_PASSWORD=${config.dbPassword}`,
        'POSTGRES_DB=arblacklist',
      ],
      volumes: [{ volumeName: pgVolume.name, containerPath: '/var/lib/postgresql' }],
      ports: [{ internal: 5432, external: 5432 }],
      restart: 'unless-stopped',
    }, childOpts)

    const minioContainer = new docker.Container('minio', {
      name: n('minio'),
      image: 'minio/minio:RELEASE.2025-09-07T16-13-09Z', //latest @2026-04-06
      networksAdvanced: [{ name: network.name }],
      envs: [
        'MINIO_ROOT_USER=shepherd',
        `MINIO_ROOT_PASSWORD=${config.minioPassword}`,
      ],
      volumes: [{ volumeName: minioVolume.name, containerPath: '/data' }],
      command: ['server', '/data', '--console-address', ':9001'],
      ports: [
        { internal: 9000, external: 9000 },
        { internal: 9001, external: 9001 },
      ],
      restart: 'unless-stopped',
    }, childOpts)

    // create MinIO buckets via mc one-shot container
    new docker.Container('minio-setup', {
      name: n('minio-setup'),
      image: 'minio/mc:RELEASE.2025-08-13T08-35-41Z', //latest @2026-04-06
      networksAdvanced: [{ name: network.name }],
      envs: [
        `MC_HOST_local=http://shepherd:${config.minioPassword}@${n('minio')}:9000`,
      ],
      entrypoints: ['sh', '-c', [
        'until mc ls local > /dev/null 2>&1; do sleep 1; done',
        'mc mb --ignore-existing local/shepherd-input',
        'mc mb --ignore-existing local/shepherd-lists',
        `mc anonymous set download local/shepherd-lists`,
      ].join(' && ')],
      mustRun: false,
    }, { ...childOpts, dependsOn: [minioContainer] })

    const elasticmqContainer = new docker.Container('elasticmq', {
      name: n('elasticmq'),
      image: 'softwaremill/elasticmq-native:1.7.1', //latest @2026-04-06
      networksAdvanced: [{ name: network.name }],
      volumes: [
        { volumeName: elasticMqVolume.name, containerPath: '/data' },
        { volumeName: configVolume.name, containerPath: '/config', readOnly: true },
      ],
      command: ['-Dconfig.file=/config/elasticmq.conf'],
      labels: [{ label: 'shepherd.classifiers', value: config.classifiers.join(',') }],
      ports: [
        { internal: 9324, external: 9324 },
      ],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [elasticMqConfContainer] })

    new docker.Container('elasticmq-ui', {
      name: n('elasticmq-ui'),
      image: 'softwaremill/elasticmq-ui:1.7.1', //latest @2026-04-06
      networksAdvanced: [{ name: network.name }],
      envs: [`SQS_ENDPOINT=http://${n('elasticmq')}:9324`],
      ports: [{ internal: 3000, external: 9325 }],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [elasticmqContainer] })

    const minio2mqImage = new docker.Image('minio2mq', {
      build: {
        context: path.join(import.meta.dirname, '../minio2mq'),
        builderVersion: docker.BuilderVersion.BuilderV1,
        platform: config.buildPlatform,
      },
      imageName: n('minio2mq'),
      skipPush: true,
    }, childOpts)

    new docker.Container('minio2mq', {
      name: n('minio2mq'),
      image: minio2mqImage.imageName,
      networksAdvanced: [{ name: network.name }],
      envs: [
        `MINIO_ENDPOINT=${n('minio')}`,
        `MINIO_ACCESS_KEY=shepherd`,
        `MINIO_SECRET_KEY=${config.minioPassword}`,
        `MINIO_BUCKET=shepherd-input`,
        `SQS_ENDPOINT=http://${n('elasticmq')}:9324`,
        `SQS_INPUT_QUEUE_URL=http://${n('elasticmq')}:9324/000000000000/shepherd2-input-q`,
        ...(config.slack_webhook ? [`SLACK_WEBHOOK=${config.slack_webhook}`] : []),
      ],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [minio2mqImage, minioContainer, elasticmqContainer] })

    const redisVolume = new docker.Volume('redis-data', { name: n('redis-data') }, childOpts)
    new docker.Container('redis', {
      name: n('redis'),
      image: 'redis:7-alpine',
      networksAdvanced: [{ name: network.name }],
      volumes: [{ volumeName: redisVolume.name, containerPath: '/data' }],
      command: ['redis-server', '--appendonly', 'yes'],
      ports: [{ internal: 6379, external: 6379 }],
      restart: 'unless-stopped',
    }, childOpts)

    new docker.Container('nginx', {
      name: n('nginx'),
      image: 'nginx:stable-alpine',
      networksAdvanced: [{ name: network.name }],
      ports: [
        { internal: 80, external: 80 },
        { internal: 443, external: 443 },
      ],
      restart: 'unless-stopped',
    }, childOpts)

    this.network = network
    this.postgresHost = n('postgres')
    this.minioEndpoint = `http://${n('minio')}:9000`
    this.sqsEndpoint = `http://${n('elasticmq')}:9324`
    this.redisHost = n('redis')

    this.registerOutputs({
      postgresHost: this.postgresHost,
      minioEndpoint: this.minioEndpoint,
      sqsEndpoint: this.sqsEndpoint,
      redisHost: this.redisHost,
    })
  }
}
