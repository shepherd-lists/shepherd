import knex, { Knex } from 'knex'

if (!process.env.DB_HOST) throw new Error('DB_HOST not set')

let cachedConnection: Knex<any, unknown[]>


export default function knexCreate() {
	if (cachedConnection) {
		console.log("using cached db connection");
		return cachedConnection;
	}
	let connTimeout = 120000 //default value
	if (process.env.NODE_ENV === 'test') {
		connTimeout = 5000
	}

	console.log(`creating new db connection to ${process.env.DB_HOST} with timeout ${connTimeout}ms`);
	const connection = knex({
		client: 'pg',
		pool: {
			// propagateCreateError: false,
			min: 0,
			max: 500,
		},
		connection: {
			host: process.env.DB_HOST,
			port: 5432,
			user: 'postgres',
			password: 'postgres',
			database: 'arblacklist',
		},
		acquireConnectionTimeout: connTimeout
	})

	connection.raw('select 1;').then(res => {
		console.info(`db connection tested OK: ${res.rowCount === 1}, host: ${process.env.DB_HOST}`)
	}).catch(e =>
		console.error(`*** ERROR IN DB CONNECTION *** ${JSON.stringify(e)}, host: ${process.env.DB_HOST}`)
	)

	cachedConnection = connection;
	return connection;
};
