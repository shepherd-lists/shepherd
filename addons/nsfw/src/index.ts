import { slackLog } from '../../services/libs/utils/slackLog'
import { runClassifierHost } from '../../classifier-host/src/index'
import { loadPlugins } from '../../classifier-host/src/load-plugins'

const main = async () => {
  const plugins = await loadPlugins('shepherd.config.json')
  await runClassifierHost(plugins, { addonName: process.env.ADDON_NAME })
}

main().catch(async error => {
  const e = error as Error
  await slackLog('nsfw-bootstrap', e.name, e.message)
  throw e
})
