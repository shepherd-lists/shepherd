import dbConnection from '../src/common/utils/db-connection'

const knex = dbConnection()

describe('close db connection after all tests done', ()=>{
	it('closes the db connection', async function () {
		await knex.destroy().catch((e)=>console.log('error in destroy',e))
	}).timeout(0)
})
