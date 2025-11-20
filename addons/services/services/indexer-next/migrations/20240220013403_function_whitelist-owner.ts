import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.raw(`
		CREATE OR REPLACE FUNCTION whitelist_owner(owner_name VARCHAR(43))
		RETURNS SETOF owners_whitelist AS $$
		BEGIN
				-- Check if owner_name length is exactly 43 characters
				IF LENGTH(owner_name) != 43 THEN
						RAISE EXCEPTION 'owner_name must be exactly 43 characters.';
				END IF;
				
				RETURN QUERY
				INSERT INTO owners_whitelist(owner)
				VALUES (owner_name)
				RETURNING *;
		END;
		$$ LANGUAGE plpgsql;	
	`)

}


export async function down(knex: Knex): Promise<void> {
	await knex.raw(`
		DROP FUNCTION IF EXISTS whitelist_owner(owner_names VARCHAR(43));
	`)
}

