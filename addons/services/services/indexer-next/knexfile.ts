
module.exports = {
	client: 'pg',
	connection: {
		host: process.env.DB_HOST,
		port: 5432,
		database: 'arblacklist',
		user: process.env.DB_USER || 'shepherd',
		password: process.env.DB_PASSWORD || ''
	},
	pool: {
		min: 0,
		max: 10
	},
	migrations: {
		// tableName: 'knex_migrations_wallets'
	}
}
