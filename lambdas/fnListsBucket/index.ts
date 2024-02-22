import { ALBResult } from 'aws-lambda'


export const handler = async (event: any): Promise<ALBResult> => {
	console.info('event', JSON.stringify(event))

	return {
		statusCode: 200,
		headers: {
			'content-type': 'text/plain',
		},
		body: 'Hello \nfrom \nLambda!\n\n',
	}
}