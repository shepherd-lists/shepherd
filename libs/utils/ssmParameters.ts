import { GetParameterCommand, SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm'
import { slackLog } from './slackLog'


const ssm = new SSMClient() //current region

export const readParamLive = async (name: string) => JSON.parse(
	(await ssm.send(new GetParameterCommand({
		Name: `/shepherd/live/${name}`,
		WithDecryption: true, // ignored if unencrypted
	}))).Parameter!.Value as string // throw when undefined
)
/** standard tier string max of 4kb */
export const writeParamLive = async (name: string, value: Array<object>) => {
	const Value = JSON.stringify(value)
	if (Value.length > 4096) throw new Error(`Value too long: ${Value.length}`)

	slackLog(writeParamLive.name, `'/shepherd/live/${name}' <= ${Value}`)

	ssm.send(new PutParameterCommand({
		Name: `/shepherd/live/${name}`,
		Value,
		Type: 'String',
		Overwrite: true,
	}))
}

