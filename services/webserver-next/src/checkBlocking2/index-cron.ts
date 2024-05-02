/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
 *
 * this file contains only the timers
 */
const FLAGGED_INTERVAL = 30_000 // 30 secs 
const OWNERS_INTERVAL = 300_000 // 5 mins
const DNSR_INTERVAL = 600_000 // 10 mins


import { checkFlaggedTxids } from './index-entry'
/** main entrypoint */
setInterval(checkFlaggedTxids, FLAGGED_INTERVAL)


