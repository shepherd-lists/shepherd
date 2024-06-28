/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
*
* this file contains only the timers
*/
import { ChildProcess, fork } from 'child_process'
import { alertStateCronjob } from './event-tracking'
import { checkFlaggedTxids, checkOwnersTxids } from './txids/txids-entrypoints'
import { checkRanges } from './ranges/ranges-entrypoint'


const FLAGGED_INTERVAL = 30_000 // 30 secs 
const OWNERS_INTERVAL = 300_000 // 5 mins N.B. owners will be large and take hours to complete
const DNSR_INTERVAL = 600_000 // 10 mins
const RANGES_INTERVAL = 60_000 // 1 min

/** main entrypoints */

setInterval(checkFlaggedTxids, FLAGGED_INTERVAL)
setInterval(checkOwnersTxids, OWNERS_INTERVAL)

setInterval(checkRanges, RANGES_INTERVAL)


/** cron for alarm state */
setInterval(alertStateCronjob, 10_000)

