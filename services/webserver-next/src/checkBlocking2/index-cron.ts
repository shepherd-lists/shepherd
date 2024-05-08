/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
*
* this file contains only the timers
*/
import { alertStateCronjob } from '../checkBlocking/event-tracking'
import { checkFlaggedTxids, checkOwnersTxids } from './index-entry'


const FLAGGED_INTERVAL = 30_000 // 30 secs 
const OWNERS_INTERVAL = 300_000 // 5 mins N.B. owners will be large and take hours to complete
const DNSR_INTERVAL = 600_000 // 10 mins

/** main entrypoints */

setInterval(checkFlaggedTxids, FLAGGED_INTERVAL)
// setInterval(checkOwnersTxids, OWNERS_INTERVAL)
// checkOwnersTxids()

/** temporary cron for alarm state until this is fixed by using immediate set/unset */
setInterval(alertStateCronjob, 30_000)
