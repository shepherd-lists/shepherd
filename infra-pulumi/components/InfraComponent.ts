import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
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

    new docker.Container('minio', {
      name: n('minio'),
      image: 'minio/minio',
      networksAdvanced: [{ name: network.name }],
      envs: [
        'MINIO_ROOT_USER=shepherd',
        pulumi.interpolate`MINIO_ROOT_PASSWORD=${minioPassword}`,
      ],
      volumes: [{ volumeName: minioVolume.name, containerPath: '/data' }],
      command: ['server', '/data', '--console-address', ':9001'],
      ports: [{ internal: 9001, external: 9001 }],
      restart: 'unless-stopped',
    }, childOpts)

    new docker.Container('elasticmq', {
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
