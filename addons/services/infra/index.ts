import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import { type Config } from '../../../Config'
import { ServicesComponent } from './components/ServicesComponent'

const stackName = pulumi.getStack()
const { config } = await import(`../../../config.${stackName}.ts`) as { config: Config }

const provider = new docker.Provider('remote', { host: config.dockerHost })
const opts = { provider }

const infraRef = new pulumi.StackReference(`${pulumi.getOrganization()}/shepherd-infra/${stackName}`)
const networkName = infraRef.getOutput('networkName') as pulumi.Output<string>

new ServicesComponent('services', { config, stackName, infraRef, networkName }, opts)
