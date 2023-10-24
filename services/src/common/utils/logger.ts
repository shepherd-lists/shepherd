
/**
 *
 * @param args single object will be printed as json text. multiple arguments will be prefixed with the first argument and concatenated with spaces by default.
 */
export const logger = (...args: unknown[]) => {

	if(args.length === 0){
		return console.log()
	}

	/* print single objects as json text */
	if(args.length === 1 && typeof args[0] === 'object'){
		return console.log(JSON.stringify(args[0]))
	}

	const prefix = '[' + args[0] + ']'
	args.shift()

	console.log(prefix, ...args)
}
