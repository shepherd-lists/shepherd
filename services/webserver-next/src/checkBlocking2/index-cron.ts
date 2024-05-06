/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
 *
 * this file contains only the timers
 */
const FLAGGED_INTERVAL = 30_000 // 30 secs 
const OWNERS_INTERVAL = 300_000 // 5 mins N.B. owners will be large and take hours to complete
const DNSR_INTERVAL = 600_000 // 10 mins


import { checkFlaggedTxids, checkOwnersTxids } from './index-entry'
/** main entrypoints */
setInterval(checkFlaggedTxids, FLAGGED_INTERVAL)
// setInterval(checkOwnersTxids, OWNERS_INTERVAL)
// checkOwnersTxids()
