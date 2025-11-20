import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.raw(`
		DROP FUNCTION IF EXISTS add_owner(owner_names VARCHAR(43));
	`)
	await knex.raw(`
		CREATE OR REPLACE FUNCTION block_owner(owner_name VARCHAR(43))
		RETURNS SETOF owners_list AS $$
		BEGIN
				-- Check if owner_name length is exactly 43 characters
				IF LENGTH(owner_name) != 43 THEN
						RAISE EXCEPTION 'owner_name must be exactly 43 characters.';
				END IF;
				
				RETURN QUERY
				INSERT INTO owners_list(owner, add_method)
				VALUES (owner_name, 'manual')
				RETURNING *;
		END;
		$$ LANGUAGE plpgsql;	
	`)

}


export async function down(knex: Knex): Promise<void> {
	await knex.raw(`
		DROP FUNCTION IF EXISTS block_owner(owner_names VARCHAR(43));
	`)
	await knex.raw(`
	CREATE OR REPLACE FUNCTION add_owner(owner_name VARCHAR(43))
	RETURNS SETOF owners_list AS $$
	BEGIN
			-- Check if owner_name length is exactly 43 characters
			IF LENGTH(owner_name) != 43 THEN
					RAISE EXCEPTION 'owner_name must be exactly 43 characters.';
			END IF;
			
			RETURN QUERY
			INSERT INTO owners_list(owner, add_method)
			VALUES (owner_name, 'manual')
			RETURNING *;
	END;
	$$ LANGUAGE plpgsql;	
`)
}

