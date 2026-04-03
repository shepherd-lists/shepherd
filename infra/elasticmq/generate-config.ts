import type { Config } from '../../Config'
import { classifierQueueName } from '../../Config'
import * as fs from 'fs'
import * as path from 'path'

export function generateElasticMqConfig(config: Config, outputPath: string) {
  const queues: string[] = []

  // input queue + dlq
  queues.push(`
  shepherd2-input-q {
    deadLettersQueue {
      name = "shepherd2-input-dlq"
      maxReceiveCount = 3
    }
    visibilityTimeout = 15 minutes
    receiveMessageWait = 20 seconds
  }
  shepherd2-input-dlq {}`)

  // classifier output queues + dlqs
  for (let i = 0; i < config.classifiers.length; i++) {
    const { queueName, dlqName } = classifierQueueName(config, i)
    queues.push(`
  ${queueName} {
    deadLettersQueue {
      name = "${dlqName}"
      maxReceiveCount = 10
    }
    visibilityTimeout = 15 minutes
    receiveMessageWait = 20 seconds
  }
  ${dlqName} {}`)
  }

  const conf = `include classpath("application.conf")

queues {${queues.join('')}
}
`
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, conf)
}
