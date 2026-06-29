import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import { type Config } from '../../../Config'
import { AddonComponent } from './components/AddonComponent'
import { protectStacksIfNeeded } from '../../../protect-stacks'

protectStacksIfNeeded()

const stackName = pulumi.getStack()
const { config } = await import(`../../../config.${stackName}.ts`) as { config: Config }

const provider = new docker.Provider('remote', { host: config.dockerHost })
const opts = { provider }

const infraRef = new pulumi.StackReference(`${pulumi.getOrganization()}/shepherd-infra/${stackName}`)
const networkName = infraRef.getOutput('networkName') as pulumi.Output<string>

/* this addon is 'nsfw'; nsfw/Dockerfile only defines an `nsfw` target. a different addon needs its own infra + Dockerfile */
const addonName = 'nsfw'

new AddonComponent(addonName, { config, stackName, infraRef, networkName }, opts)
