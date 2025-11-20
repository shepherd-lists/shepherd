


export const createMutex = () => {
	let locked = false
	const queue: Array<() => void> = []

	const lock = (): Promise<() => void> => {
		return new Promise((resolve) => {
			const tryAcquire = () => {
				if (!locked) {
					locked = true
					resolve(unlock)
				} else {
					queue.push(tryAcquire)
				}
			}

			const unlock = () => {
				locked = false
				if (queue.length > 0) {
					const next = queue.shift()!
					next()
				}
			}

			tryAcquire()
		})
	}

	const acquireLock = async <T, Args extends any[]>(
		callback: (...args: Args) => Promise<T> | T,
		...args: Args
	): Promise<T> => {
		const unlock = await lock()
		try {
			return await callback(...args)
		} finally {
			unlock()
		}
	}

	return {
		acquireLock,
	}
}
