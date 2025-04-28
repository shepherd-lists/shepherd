


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

	const runExclusive = async <T>(callback: () => Promise<T> | T): Promise<T> => {
		const unlock = await lock()
		try {
			return await callback()
		} finally {
			unlock()
		}
	}

	return {
		runExclusive,
	}
}
