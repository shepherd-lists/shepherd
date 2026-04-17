export const lokiLogDriver = 'loki'

export const lokiLogOpts = {
  'loki-url': 'http://localhost:3100/loki/api/v1/push',
  'loki-batch-size': '400',
  'mode': 'non-blocking',
  'max-buffer-size': '5m',
  'loki-retries': '2',
  'loki-max-backoff': '1s',
  'loki-timeout': '3s',
}
