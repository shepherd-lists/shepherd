/**
 * objectives:
 * - check that IPs in lists are correctly blocking data after it is flagged.
 * - also run the resource intensive rangelist dertivations so that they do not 
 * 	 build up and crash the system.
 * 
 * this file contains only the timer
 */
import { streamLists } from "./checkBlocking-functions";

const INTERVAL = 1_000 * 60 * 5 // 5 minutes

/** main entrypoint */
setInterval(streamLists, INTERVAL);
/** run once at load also */
streamLists();
