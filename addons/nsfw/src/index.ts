import { slackLog } from '../../classifier-host/src/utils/slackLog'
import { runClassifierHost } from '../../classifier-host/src/index'
import { loadPlugin } from '../../classifier-host/src/0-init/load-plugins'

const main = async () => {
  const plugin = await loadPlugin('shepherd.config.json')
  await runClassifierHost(plugin, { addonName: process.env.ADDON_NAME })
}

main().catch(async error => {
  const e = error as Error
  await slackLog('nsfw-bootstrap', e.name, e.message)
  throw e
})
