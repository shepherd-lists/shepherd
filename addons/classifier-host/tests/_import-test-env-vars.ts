/**
 * Required env vars validated at module load by ../src/constants.ts (and the shared SQS/S3
 * clients). Import this BEFORE any module that reads constants, so loading them does not throw.
 */
process.env.ADDON_NAME ??= 'test-addon'
process.env.AWS_INPUT_BUCKET ??= 'test-bucket'
process.env.AWS_SQS_INPUT_QUEUE ??= 'https://sqs/input-q'
process.env.AWS_SQS_OUTPUT_QUEUE ??= 'https://sqs/output-q'
process.env.AWS_SQS_SINK_QUEUE ??= 'https://sqs/sink-q'
