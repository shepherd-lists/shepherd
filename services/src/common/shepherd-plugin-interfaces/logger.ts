import col from 'ansi-colors'


export const logger = (...args: any[]) => {
	/* print single objects as json text */
	if(args.length === 1 && typeof args[0] === 'object'){
		console.log(JSON.stringify(args[0]))
		return;
	}

	let prefix = '[logger]'
	if(args.length > 1){
		prefix = '[' + args[0] + ']'
		args.shift()
	}

	console.log(col.blue(prefix), ...args)

}