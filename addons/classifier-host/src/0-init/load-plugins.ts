import { stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FilterPluginInterface } from 'shepherd-plugin-interfaces'

interface ShepherdAddonConfig {
  plugin: string
  lowmem?: boolean
}

let cachedConfigPath: string | undefined
let cachedPlugin: FilterPluginInterface | undefined

const stripPinnedVersion = (specifier: string) => {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) {
    return specifier
  }

  if (specifier.startsWith('@')) {
    const scopeSlash = specifier.indexOf('/', 1)
    const versionAt = specifier.lastIndexOf('@')
    if (scopeSlash > 0 && versionAt > scopeSlash) {
      return specifier.slice(0, versionAt)
    }
    return specifier
  }

  const versionAt = specifier.lastIndexOf('@')
  if (versionAt > 0) return specifier.slice(0, versionAt)
  return specifier
}

const resolvePathLikeImport = async (specifier: string, configPath: string) => {
  const fromPath = specifier.startsWith('file:') ? specifier.slice('file:'.length) : specifier
  const resolvedPath = path.isAbsolute(fromPath)
    ? fromPath
    : path.resolve(path.dirname(configPath), fromPath)

  const stats = await stat(resolvedPath)
  if (stats.isDirectory()) {
    const packageJsonPath = path.join(resolvedPath, 'package.json')
    const packageJsonRaw = await readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonRaw) as { module?: string; main?: string }
    const entryPoint = packageJson.module ?? packageJson.main ?? 'index.js'
    return pathToFileURL(path.resolve(resolvedPath, entryPoint)).href
  }

  return pathToFileURL(resolvedPath).href
}

const importPlugin = async (specifier: string, configPath: string) => {
  const cleanedSpecifier = stripPinnedVersion(specifier)
  const importTarget = cleanedSpecifier.startsWith('.') || cleanedSpecifier.startsWith('/') || cleanedSpecifier.startsWith('file:')
    ? await resolvePathLikeImport(cleanedSpecifier, configPath)
    : cleanedSpecifier

  const pluginModule = await import(importTarget)
  const plugin = (pluginModule.default ?? pluginModule) as FilterPluginInterface

  if (typeof plugin?.init !== 'function' || typeof plugin?.checkImage !== 'function') {
    throw new Error(`Invalid plugin '${specifier}': expected default export with init() and checkImage()`)
  }

  await plugin.init()
  console.info('plugin ready:', specifier)
  return plugin
}

export const loadPlugin = async (configFileName = 'shepherd.config.json'): Promise<FilterPluginInterface> => {
  const configPath = path.isAbsolute(configFileName)
    ? configFileName
    : path.resolve(process.cwd(), configFileName)

  if (cachedConfigPath === configPath && cachedPlugin) {
    return cachedPlugin
  }

  const rawConfig = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(rawConfig) as ShepherdAddonConfig

  if (typeof parsed.plugin !== 'string' || parsed.plugin.length === 0) {
    throw new Error(`Invalid plugin config at ${configPath}: 'plugin' must be a non-empty string`)
  }

  const plugin = await importPlugin(parsed.plugin, configPath)

  cachedConfigPath = configPath
  cachedPlugin = plugin
  return plugin
}
