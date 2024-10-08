import { slackLog } from '../../../../libs/utils/slackLog'
import { checkForManuallyModifiedOwners } from './check-manually-added-owners'
import { updateFullTxidsRanges } from '../../../../libs/s3-lists/update-lists'
import { processBlockedOwnersQueue } from '../../../../libs/block-owner/owner-blocking'


if (!process.env.FN_OWNER_BLOCKING) throw new Error('missing env var, FN_OWNER_BLOCKING')
if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


export const ownerChecks = async () => {
	/** restart on errors */
	let runonce = true
	while (true) {
		try {

			/** check if lists need to be updated */
			//this should be in a setInterval with it's own try-catch?
			if (
				await checkForManuallyModifiedOwners()
				|| await processBlockedOwnersQueue()
			) {
				console.info('owner modified. recreating lists')
				const updateLists = await updateFullTxidsRanges()
				console.info({ updateLists })
			} else {
				console.info(ownerChecks.name, 'nothing to do. sleeping for 50 seconds...')
				await new Promise(resolve => setTimeout(resolve, 50_000))
			}

		} catch (err: unknown) {
			const e = err as Error
			await slackLog(
				ownerChecks.name,
				`Fatal error ❌ ${e.name}:${e.message}\n`,
				err,
				'\nrestarting in 30 seconds...'
			)
			await sleep(30_000)
		}
	}
}
