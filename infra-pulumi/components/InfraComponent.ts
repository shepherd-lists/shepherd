import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import type { Config } from '../../Config'

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
  public readonly natsUrl: string

  constructor(name: string, args: InfraComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('shepherd:infra:InfraComponent', name, {}, opts)

    const childOpts = { ...opts, parent: this }
    const { network, dbPassword, minioPassword, stackName } = args
    const n = (s: string) => `${s}-shep-${stackName}`

    const pgVolume = new docker.Volume('pg-data', { name: n('pg-data') }, childOpts)
    const minioVolume = new docker.Volume('minio-data', { name: n('minio-data') }, childOpts)
    const natsVolume = new docker.Volume('nats-data', { name: n('nats-data') }, childOpts)

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

    new docker.Container('nats', {
      name: n('nats'),
      image: 'nats:latest',
      networksAdvanced: [{ name: network.name }],
      volumes: [{ volumeName: natsVolume.name, containerPath: '/data' }],
      command: ['-js', '-sd', '/data', '-m', '8222'],
      ports: [{ internal: 8222, external: 8222 }],
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
    this.natsUrl = `nats://${n('nats')}:4222`

    this.registerOutputs({
      postgresHost: this.postgresHost,
      minioEndpoint: this.minioEndpoint,
      natsUrl: this.natsUrl,
    })
  }
}
