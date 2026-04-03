import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import { InfraComponent } from './components/InfraComponent'

const stackName = pulumi.getStack()
const { config } = await import(`../config.${stackName}.ts`)

const stackConfig = new pulumi.Config()

// pulumi config set --secret dbPassword <password>
const dbPassword = stackConfig.requireSecret('dbPassword')
// pulumi config set --secret minioPassword <password>
const minioPassword = stackConfig.requireSecret('minioPassword')

const { dockerHost, repoPath } = config

const provider = new docker.Provider('docker', { host: dockerHost })
const opts = { provider }

const network = new docker.Network('shepherd', { name: `shepherd-${stackName}` }, opts)

new InfraComponent('infra', { config, network, dbPassword, minioPassword, repoPath, stackName }, opts)
