import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import * as path from 'path'
import { execSync } from 'child_process'

/** resolve $HOME on the docker host — local if same machine, over ssh if remote */
const resolveDockerHostHome = (dockerHost: string) => {
  if (!dockerHost.startsWith('ssh://')) return process.env.HOME!
  const sshHost = dockerHost.replace(/^ssh:\/\//, '')
  return execSync(`ssh ${sshHost} 'echo $HOME'`).toString().trim()
}
import { naming, type Config } from '../../Config'
import { generateElasticMqConfigString } from '../elasticmq/generate-config'
import { lokiLogDriver, lokiLogOpts } from './lokiLogConfig'

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

    const volOpts = { ...childOpts, retainOnDelete: true }
    const pgVolume = new docker.Volume('pg-data', { name: n('pg-data') }, volOpts)
    const minioVolume = new docker.Volume('minio-data', { name: n('minio-data') }, volOpts)
    const elasticMqVolume = new docker.Volume('elasticmq-data', { name: n('elasticmq-data') }, volOpts)

    const elasticMqConf = generateElasticMqConfigString(config)

    /** postgres & backup */

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
      ports: [{ internal: 5432, external: 5432, ip: '127.0.0.1' }],
      logDriver: lokiLogDriver,
      logOpts: lokiLogOpts,
      restart: 'unless-stopped',
    }, childOpts)

    // b2 off-site backup: after dumps run, rclone mirrors /backups to a per-stack prefix
    // in the bucket. local retention has already pruned old files, so sync mirrors that too.
    const b2 = config.b2
    const b2SyncCron = b2
      ? `echo '5 0 * * * rclone sync /backups b2:${b2.bucket}/${stackName}' >> /etc/crontabs/root`
      : ''

    new docker.Container('pg-backup', {
      name: n('pg-backup'),
      image: 'alpine:3',
      networksAdvanced: [{ name: network.name }],
      envs: [
        `PGHOST=${n('postgres')}`,
        `PGUSER=shepherd`,
        `PGPASSWORD=${config.dbPassword}`,
        `PGDATABASE=arblacklist`,
        ...(b2 ? [
          'RCLONE_CONFIG_B2_TYPE=b2',
          `RCLONE_CONFIG_B2_ACCOUNT=${b2.keyId}`,
          `RCLONE_CONFIG_B2_KEY=${b2.appKey}`,
        ] : []),
      ],
      volumes: [{ hostPath: `${resolveDockerHostHome(config.dockerHost)}/backups/shepherd`, containerPath: '/backups' }],
      command: ['sh', '-c', [
        `apk add --no-cache postgresql-client${b2 ? ' rclone' : ''}`,
        // append backup crontab: daily at midnight UTC, weekly on Sundays
        `echo '0 0 * * * pg_dump -Fc > /backups/daily-$(date +\\%Y\\%m\\%d).dump && find /backups -name "daily-*.dump" -mtime +7 -delete' >> /etc/crontabs/root`,
        `echo '0 0 * * 0 pg_dump -Fc > /backups/weekly-$(date +\\%Y\\%m\\%d).dump && find /backups -name "weekly-*.dump" -mtime +90 -delete' >> /etc/crontabs/root`,
        ...(b2 ? [b2SyncCron] : []),
        'crond -f -l 2',
      ].join(' && ')],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [postgresContainer] })

    /** minio & setup */

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
        { internal: 9000, external: 9000, ip: '127.0.0.1' },
        { internal: 9001, external: 9001, ip: '127.0.0.1' },
      ],
      logDriver: lokiLogDriver,
      logOpts: lokiLogOpts,
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

    /** elasticmq & related */

    const elasticmqContainer = new docker.Container('elasticmq', {
      name: n('elasticmq'),
      image: 'softwaremill/elasticmq-native:1.7.1', //latest @2026-04-06
      networksAdvanced: [{ name: network.name }],
      volumes: [
        { volumeName: elasticMqVolume.name, containerPath: '/data' },
      ],
      uploads: [{ file: '/opt/elasticmq.conf', content: elasticMqConf }],
      command: ['-Dconfig.file=/opt/elasticmq.conf'],
      ports: [
        { internal: 9324, external: 9324, ip: '127.0.0.1' },
      ],
      logDriver: lokiLogDriver,
      logOpts: lokiLogOpts,
      restart: 'unless-stopped',
    }, childOpts)

    new docker.Container('elasticmq-ui', {
      name: n('elasticmq-ui'),
      image: 'softwaremill/elasticmq-ui:1.7.1', //latest @2026-04-06
      networksAdvanced: [{ name: network.name }],
      envs: [`SQS_ENDPOINT=http://${n('elasticmq')}:9324`],
      ports: [{ internal: 3000, external: 9325, ip: '127.0.0.1' }],
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

    /** redis */

    const redisVolume = new docker.Volume('redis-data', { name: n('redis-data') }, volOpts)
    new docker.Container('redis', {
      name: n('redis'),
      image: 'redis:7-alpine',
      networksAdvanced: [{ name: network.name }],
      volumes: [{ volumeName: redisVolume.name, containerPath: '/data' }],
      command: ['redis-server', '--appendonly', 'yes'],
      ports: [{ internal: 6379, external: 6379, ip: '127.0.0.1' }],
      logDriver: lokiLogDriver,
      logOpts: lokiLogOpts,
      restart: 'unless-stopped',
    }, childOpts)

    /** nginx */

    const nginxConfigPath = path.join(import.meta.dirname, '../nginx/nginx.conf')
    new docker.Container('nginx', {
      name: n('nginx'),
      image: 'nginx:stable-alpine',
      networksAdvanced: [{ name: network.name }],
      uploads: [{ file: '/etc/nginx/nginx.conf', source: nginxConfigPath }],
      ports: [
        { internal: 80, external: 80 },
        // { internal: 443, external: 443 },
      ],
      logDriver: lokiLogDriver,
      logOpts: lokiLogOpts,
      restart: 'unless-stopped',
    }, childOpts)

    /** Loki + Grafana for log aggregation */

    const lokiVolume = new docker.Volume('loki-data', { name: n('loki-data') }, volOpts)
    const grafanaVolume = new docker.Volume('grafana-data', { name: n('grafana-data') }, volOpts)

    const lokiConfigPath = path.join(import.meta.dirname, '../loki/loki.yaml')

    const lokiContainer = new docker.Container('loki', {
      name: n('loki'),
      image: 'grafana/loki:3.4.2',
      networksAdvanced: [{ name: network.name }],
      volumes: [
        { volumeName: lokiVolume.name, containerPath: '/loki' },
      ],
      uploads: [{ file: '/etc/loki/loki.yaml', source: lokiConfigPath }],
      command: ['-config.file=/etc/loki/loki.yaml'],
      ports: [{ internal: 3100, external: 3100, ip: '127.0.0.1' }],
      restart: 'unless-stopped',
    }, childOpts)

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
      ],
      uploads: [{ file: '/etc/grafana/provisioning/datasources/loki.yaml', content: grafanaDatasourceConfig }],
      ports: [{ internal: 3000, external: 3001, ip: '127.0.0.1' }],
      restart: 'unless-stopped',
    }, { ...childOpts, dependsOn: [lokiContainer] })

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
