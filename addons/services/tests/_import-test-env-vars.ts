import { config } from '../../../config.dev'

process.env.NODE_ENV = 'test'
process.env.AWS_DEFAULT_REGION = 'us-east-1'
process.env.AWS_REGION = 'us-east-1'
process.env.AWS_ACCESS_KEY_ID = 'shepherd'
process.env.AWS_SECRET_ACCESS_KEY = config.minioPassword
process.env.DB_HOST = 'localhost'
process.env.DB_PASSWORD = config.dbPassword
process.env.LISTS_BUCKET = 'shepherd-lists'
process.env.AWS_INPUT_BUCKET = 'shepherd-input'
process.env.HOST_URL = config.host_url
process.env.GQL_URL = config.gql_url
process.env.GQL_URL_SECONDARY = config.gql_url_secondary
process.env.AWS_ENDPOINT_URL_S3 = 'http://127.0.0.1:9000'// #minio'
process.env.AWS_ENDPOINT_URL_SQS = 'http://127.0.0.1:9324'// #elasticmq'
process.env.REDIS_HOST = 'localhost'
process.env.ingress_nodes = JSON.stringify(config.ingress_nodes)
// process.env.http_api_nodes_url = config.http_api_nodes_url


// #used?
// FN_OWNER_BLOCKING='dummy'
// FN_INDEXER='dummy'
// FN_INIT_LISTS='use temp dev'
