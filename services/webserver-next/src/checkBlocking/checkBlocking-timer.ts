/**
 * objectives:
 * - check that IPs in lists are correctly blocking data after it is flagged.
 *
 * this file contains only the timer
 */
import { checkBlockedCronjob } from './checkBlocking-functions'

const INTERVAL = 300_000 // 5 minutes

/** main entrypoint */
setInterval(checkBlockedCronjob, INTERVAL)
/** run once at load also */
checkBlockedCronjob()

import { alertStateCronjob } from './event-tracking'

const NOT_FOUND_CRONJOB_INTERVAL = 60_000 // 1 minute

setInterval(alertStateCronjob, NOT_FOUND_CRONJOB_INTERVAL)
alertStateCronjob() // run once at load also
