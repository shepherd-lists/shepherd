import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import { Config } from '../../../Config'

const stackName = pulumi.getStack()
const { config } = await import(`../../../config.${stackName}.ts`) as { config: Config }


const provider = new docker.Provider('remote', { host: config.dockerHost })
const opts = { provider }

const infraRef = new pulumi.StackReference(`${pulumi.getOrganization()}/shepherd-infra/${stackName}`)

// TODO: call ../infra/pulumi.ts once implemented
