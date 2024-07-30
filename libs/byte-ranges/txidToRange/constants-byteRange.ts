/* for use in calculating byte ranges */
export const CHUNK_ALIGN_GENESIS = 30607159107830n //weave address where enforced 256kb chunks started
export const CHUNK_SIZE = 262144n //256kb
export const HOST_URL = process.env.HOST_URL!
export const GQL_URL_SECONDARY = process.env.GQL_URL_SECONDARY!
export const GQL_URL = process.env.GQL_URL!
export const http_api_nodes = (JSON.parse(process.env.http_api_nodes!) as { name: string; server: string; throttled?: EpochTimeStamp }[]).map(n => ({ ...n, url: `http://${n.name}:1984` }))
if (!HOST_URL) throw new Error(`Missing env var, HOST_URL:${HOST_URL}`)
if (!GQL_URL_SECONDARY) throw new Error(`Missing env var, GQL_URL_SECONDARY:${GQL_URL_SECONDARY}`)
if (!GQL_URL) throw new Error(`Missing env var, GQL_URL:${GQL_URL}`)
if (!http_api_nodes) throw new Error(`Missing env var, http_api_nodes:${http_api_nodes}`)

