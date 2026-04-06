import type { Config } from '../../Config'
import { classifierQueueName } from '../../Config'

export function generateElasticMqConfigString(config: Pick<Config, 'classifiers'>): string {
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
    const { queueName, dlqName } = classifierQueueName(config as Config, i)
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

  return `include classpath("application.conf")

queues {${queues.join('')}
}
`
}
