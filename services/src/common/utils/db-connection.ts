import knex, { Knex } from 'knex'
import { checkHeartbeat } from 'knex-utils';
import { logger } from '../shepherd-plugin-interfaces/logger';

let cachedConnection: Knex<any, unknown[]>

export default () => {
  if (cachedConnection) {
    logger("using cached db connection");
    return cachedConnection;
  }
	let connTimeout = 60000 //default value
	if(process.env.NODE_ENV === 'test'){
		connTimeout = 5000
	}

	logger("creating new db connection");
	const connection = knex({
		client: 'pg',
		pool: {
			propagateCreateError: false,
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

	checkHeartbeat(connection).then(res=>{
		if(res.isOk){
			logger('db connection tested OK')
			return
		}
		logger('*** ERROR IN DB CONNECTION ***', JSON.stringify(res), JSON.stringify(`host: ${process.env.DB_HOST}`))
	})

	cachedConnection = connection;
  return connection;
};
