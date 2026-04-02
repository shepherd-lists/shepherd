import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'
import type { Config } from '../Config'
import { InfraComponent } from './components/InfraComponent'
import { AddonComponent } from './components/AddonComponent'

const stackConfig = new pulumi.Config()

// Load shepherd config from stack config
// Set with: pulumi config set --path config <json>
const config = stackConfig.requireObject<Config>('shepherd')

// Remote Docker provider — target server over SSH
// Set with: pulumi config set dockerHost ssh://user@your-server
const dockerHost = stackConfig.require('dockerHost')

const provider = new docker.Provider('remote', {
  host: dockerHost,
})

const opts = { provider }

// Shared Docker network for all services
const network = new docker.Network('shepherd', { name: 'shepherd' }, opts)

const infra = new InfraComponent('infra', { config, network }, opts)

for (const name of config.addons) {
  new AddonComponent(`addon-${name}`, { config, infra, name }, { ...opts, dependsOn: [infra] })
}
