import * as pulumi from '@pulumi/pulumi'
// import { ioQueueNames } from '../Config' // SQS-specific — replace with NATS subject naming
import type { Config } from '../Config'
import type { InfraComponent } from './InfraComponent'

export interface AddonComponentArgs {
  config: Config
  infra: InfraComponent
  name: string
}

export class AddonComponent extends pulumi.ComponentResource {
  constructor(name: string, args: AddonComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('shepherd:infra:AddonComponent', name, {}, opts)

    // TODO: container for this addon

    this.registerOutputs({})
  }
}
