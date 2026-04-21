import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import { InfraComponent } from './components/InfraComponent'

const stackName = pulumi.getStack()
const { config } = await import(`../config.${stackName}.ts`)

const provider = new docker.Provider('docker', { host: config.dockerHost })
const opts = { provider }

const network = new docker.Network('shepherd', {
  name: `shepherd-${stackName}`,
  ipamConfigs: [{ subnet: '10.89.0.0/24', gateway: '10.89.0.1' }],
}, opts)

const infra = new InfraComponent('infra', { config, network, stackName }, opts)

export const postgresHost = infra.postgresHost
export const minioEndpoint = infra.minioEndpoint
export const sqsEndpoint = infra.sqsEndpoint
export const redisHost = infra.redisHost
export const lokiEndpoint = infra.lokiEndpoint
export const networkName = network.name
