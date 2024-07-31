// import col from 'ansi-colors'

export const logger = (...args: unknown[]) => {
	let prefix = '[logger]'
	if(args.length > 1){
		prefix = '[' + args[0] + ']'
		args.shift()
	}

	// console.log(col.magenta(prefix), ...args)
	console.log(prefix, ...args)
}