
module.exports = {
	client: 'pg',
	connection: {
		host: process.env.DB_HOST,
		port: 5432,
		database: 'arblacklist',
		user: 'postgres',
		password: 'postgres'
	},
	pool: {
		min: 0,
		max: 10
	},
	migrations: {
		tableName: 'knex_migrations_wallets'
	}
}
