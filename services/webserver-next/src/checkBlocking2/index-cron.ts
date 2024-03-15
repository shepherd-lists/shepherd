/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
 *
 * this file contains only the timer
 */
const INTERVAL = 30_000 // 30 secs 


// import { checkBlockedCronjob } from './checkBlocking-functions'
// /** main entrypoint */
// setInterval(checkBlockedCronjob, INTERVAL)
// /** run once at load also */
// checkBlockedCronjob()

// import { alertStateCronjob } from './event-tracking'

// const NOT_FOUND_CRONJOB_INTERVAL = 60_000 // 1 minute

// setInterval(alertStateCronjob, NOT_FOUND_CRONJOB_INTERVAL)
// alertStateCronjob() // run once at load also
