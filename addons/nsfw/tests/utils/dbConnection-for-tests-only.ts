import knex, { Knex } from 'knex'
import { checkHeartbeat } from 'knex-utils';

let cachedConnection: Knex<any, unknown[]>

export default () => {
  if (cachedConnection) {
    console.log("using cached db connection");
    return cachedConnection;
  }
	let connTimeout = 60_000 //default value
	if(process.env.NODE_ENV === 'test'){
		connTimeout = 5_000
	}

	console.log("creating new db connection");
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

	/** this isn't totally accurate */
	checkHeartbeat(connection).then(res=>{
		if(res.isOk){
			console.log('db connection tested OK')
			return
		}
		console.log('*** ERROR IN DB CONNECTION ***', JSON.stringify(res), JSON.stringify(`host: ${process.env.DB_HOST}`))
	})

	cachedConnection = connection;
  return connection;
};
