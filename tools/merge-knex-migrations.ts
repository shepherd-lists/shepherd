/**
 * i'm keeping this simple. it needs to be run at this commit, and before any other database schema changes occur.
 * if your installation is after this commit, ignore this script.
 */
import knexCreate from '../libs/utils/knexCreate'

const knex = knexCreate()


console.info('\n*** this will merge the "knex_migrations" and "knex_migrations_wallets" tables into one table called "knex_migrations" ***\n')

const trx = await knex.transaction()
try {
	const maxBatch = (await trx('knex_migrations').max('batch').first())!.max
	const nextBatch = maxBatch + 1
	console.debug({ maxBatch, nextBatch })

	const importRecords = await trx('knex_migrations_wallets').select('name', 'migration_time')
	importRecords.map(r => r.batch = nextBatch)
	// console.debug({ importRecords })

	const numInserts: any = await trx('knex_migrations').insert(importRecords)
	console.debug(`inserted ${numInserts.rowCount} migration records`)

	const tablesBefore = await trx.raw(`
		SELECT table_schema, table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
			-- AND table_type = 'BASE TABLE'
		ORDER BY table_schema, table_name
	`);
	console.debug('Tables before merge:', tablesBefore.rows.length);
	// console.debug((awa it trx('knex_migrations').select('*')))

	console.info('dropping tables: knex_migrations_wallets, knex_migrations_wallets_lock')
	await trx.raw('DROP TABLE IF EXISTS knex_migrations_wallets CASCADE')
	await trx.raw('DROP TABLE IF EXISTS knex_migrations_wallets_lock CASCADE')


	const tablesAfter = await trx.raw(`
		SELECT table_schema, table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
			-- AND table_type = 'BASE TABLE'
		ORDER BY table_schema, table_name
	`);
	console.debug('Tables after merge:', tablesAfter.rows.length);

	await trx.commit()
	console.info('commited changes')

	// trx.rollback() //temp for dev testing
} catch (e) {
	console.error(e)
	await trx.rollback()
} finally {
	await knex.destroy()
}
