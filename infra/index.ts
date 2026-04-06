import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import { InfraComponent } from './components/InfraComponent'

const stackName = pulumi.getStack()
const { config } = await import(`../config.${stackName}.ts`)

const provider = new docker.Provider('docker', { host: config.dockerHost })
const opts = { provider }

const network = new docker.Network('shepherd', { name: `shepherd-${stackName}` }, opts)

new InfraComponent('infra', { config, network, stackName }, opts)
