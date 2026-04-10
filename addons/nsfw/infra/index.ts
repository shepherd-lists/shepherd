import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'

const stackName = pulumi.getStack()
const { config } = await import(`../../../config.${stackName}.ts`)

const stackConfig = new pulumi.Config()
const dockerHost = stackConfig.require('dockerHost')

const provider = new docker.Provider('remote', { host: dockerHost })
const opts = { provider }

const infraRef = new pulumi.StackReference(`${pulumi.getOrganization()}/shepherd-infra/${stackName}`)

// TODO: call ../infra/pulumi.ts once implemented (step 3)
