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
  public readonly lokiEndpoint: string

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

    const postgresContainer = new docker.Container('postgres', {
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

    new docker.Container('pg-backup', {
      name: n('pg-backup'),
      image: 'alpine:3',
      networksAdvanced: [{ name: network.name }],
      envs: [
        `PGHOST=${n('postgres')}`,
        `PGUSER=shepherd`,
        `PGPASSWORD=${config.dbPassword}`,
        `PGDATABASE=arblacklist`,
      ],
      volumes: [{ hostPath: `${process.env.HOME}/backups/shepherd`, containerPath: '/backups' }],
      command: ['sh', '-c', [
        'apk add --no-cache postgresql-client',
        // append backup crontab: daily at midnight UTC, weekly on Sundays
        `echo '0 0 * * * pg_dump -Fc > /backups/daily-$(date +\\%Y\\%m\\%d).dump && find /backups -name "daily-*.dump" -mtime +7 -delete' >> /etc/crontabs/root`,
        `echo '0 0 * * 0 pg_dump -Fc > /backups/weekly-$(date +\\%Y\\%m\\%d).dump && find /backups -name "weekly-*.dump" -mtime +90 -delete' >> /etc/crontabs/root`,
        'crond -f -l 2',
      ].join(' && ')],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [postgresContainer] })

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
      logDriver: 'loki',
      logOpts: {
        'loki-url': 'http://localhost:3100/loki/api/v1/push',
        'loki-batch-size': '400',
        'mode': 'non-blocking',
        'max-buffer-size': '5m',
        'loki-retries': '2',
        'loki-max-backoff': '1s',
        'loki-timeout': '3s',
      },
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

    /** Loki + Grafana for log aggregation */

    const lokiVolume = new docker.Volume('loki-data', { name: n('loki-data') }, childOpts)
    const grafanaVolume = new docker.Volume('grafana-data', { name: n('grafana-data') }, childOpts)
    const lokiConfigVolume = new docker.Volume('loki-config', { name: n('loki-config') }, childOpts)

    const lokiConfig = `
auth_enabled: false
server:
  http_listen_port: 3100
common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory
schema_config:
  configs:
    - from: "2024-01-01"
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
limits_config:
  retention_period: 2160h
  max_query_length: 2160h
  max_entries_limit_per_query: 50000
compactor:
  working_directory: /loki/compactor
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h
  delete_request_cancel_period: 10m
  delete_request_store: filesystem
`

    const lokiConfigContainer = new docker.Container('loki-config', {
      name: n('loki-config'),
      image: 'alpine:3',
      volumes: [{ volumeName: lokiConfigVolume.name, containerPath: '/config' }],
      command: ['sh', '-c', `cat > /config/loki.yaml << 'EOF'\n${lokiConfig}EOF`],
      mustRun: false,
    }, childOpts)

    const lokiContainer = new docker.Container('loki', {
      name: n('loki'),
      image: 'grafana/loki:3.4.2',
      networksAdvanced: [{ name: network.name }],
      labels: [{ label: 'config-hash', value: Buffer.from(lokiConfig).toString('base64url').slice(0, 32) }],
      volumes: [
        { volumeName: lokiVolume.name, containerPath: '/loki' },
        { volumeName: lokiConfigVolume.name, containerPath: '/config', readOnly: true },
      ],
      command: ['-config.file=/config/loki.yaml'],
      ports: [{ internal: 3100, external: 3100 }],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [lokiConfigContainer] })

    // Grafana datasource provisioning config
    const grafanaDatasourceConfig = `
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://${n('loki')}:3100
    isDefault: true
`

    const grafanaConfigVolume = new docker.Volume('grafana-config', { name: n('grafana-config') }, childOpts)
    const grafanaConfigContainer = new docker.Container('grafana-config', {
      name: n('grafana-config'),
      image: 'alpine:3',
      volumes: [{ volumeName: grafanaConfigVolume.name, containerPath: '/config' }],
      command: ['sh', '-c', `mkdir -p /config/datasources && cat > /config/datasources/loki.yaml << 'EOF'\n${grafanaDatasourceConfig}EOF`],
      mustRun: false,
    }, childOpts)

    new docker.Container('grafana', {
      name: n('grafana'),
      image: 'grafana/grafana:11.6.0',
      networksAdvanced: [{ name: network.name }],
      envs: [
        'GF_AUTH_ANONYMOUS_ENABLED=true',
        'GF_AUTH_ANONYMOUS_ORG_ROLE=Admin',
        'GF_AUTH_DISABLE_LOGIN_FORM=true',
      ],
      volumes: [
        { volumeName: grafanaVolume.name, containerPath: '/var/lib/grafana' },
        { volumeName: grafanaConfigVolume.name, containerPath: '/etc/grafana/provisioning', readOnly: true },
      ],
      ports: [{ internal: 3000, external: 3001 }],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [lokiContainer, grafanaConfigContainer] })

    this.lokiEndpoint = `http://${n('loki')}:3100`

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
      lokiEndpoint: this.lokiEndpoint,
    })
  }
}
