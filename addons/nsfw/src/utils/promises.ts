export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** returns true if the supplied promise is pending */
export const isPending = async <T>(promise: Promise<T>) => {
  const pending = {pending: true} //not a promise, if it wins race means pending
	try{ 
		return (await Promise.race([promise, pending])) === pending; 
	}
	catch(err){	return false; } //reject is not pending
}
