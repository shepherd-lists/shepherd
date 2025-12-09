export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** returns true if the supplied promise is pending */
const isPending = async <T>(promise: Promise<T>) => {
	const pending = { pending: true } //not a promise, if it wins race means pending
	try {
		return (await Promise.race([promise, pending])) === pending
	}
	catch (err) { return false } //reject is not pending
}

/** use isPending to filter an array */
export const filterPendingOnly = async <T>(promises: Promise<T>[]) => {
	const results = await Promise.all(promises.map(async p => await isPending(p)))
	return promises.filter((_, i) => results[i])
}