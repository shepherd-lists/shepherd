import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import type { Config } from '../Config'

export interface InfraComponentArgs {
  config: Config
  network: docker.Network
}

export interface InfraOutputs {
  network: docker.Network
  postgresHost: pulumi.Output<string>
  minioEndpoint: pulumi.Output<string>
  natsUrl: pulumi.Output<string>
}

export class InfraComponent extends pulumi.ComponentResource {
  public readonly network: docker.Network
  public readonly postgresHost: pulumi.Output<string>
  public readonly minioEndpoint: pulumi.Output<string>
  public readonly natsUrl: pulumi.Output<string>

  constructor(name: string, args: InfraComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('shepherd:infra:InfraComponent', name, {}, opts)

    // TODO: postgres container
    // TODO: minio container
    // TODO: nats container
    // TODO: caddy container

    this.network = args.network
    this.postgresHost = pulumi.output('todo')
    this.minioEndpoint = pulumi.output('todo')
    this.natsUrl = pulumi.output('todo')

    this.registerOutputs({
      postgresHost: this.postgresHost,
      minioEndpoint: this.minioEndpoint,
      natsUrl: this.natsUrl,
    })
  }
}
