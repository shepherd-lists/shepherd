-- -- Deploy fresh database tables
-- \i '/docker-entrypoint-initdb.d/tables/txs.sql'

CREATE TABLE txs (
	id SERIAL PRIMARY KEY,
	txid CHARACTER(43) UNIQUE NOT NULL,
	content_type TEXT NOT NULL,
	content_size BIGINT NOT NULL,
	flagged BOOLEAN,
	valid_data BOOLEAN,
	data_reason TEXT,
	nsfw_porn real,
	nsfw_sexy real,
	nsfw_hentai real,
	nsfw_neutral real,
	nsfw_drawings real,
	last_update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT cc_id CHECK ((char_length(txid) = 43))
);


CREATE TABLE states (
	id SERIAL PRIMARY KEY,
	pname TEXT NOT NULL,
	value INT NOT NULL
);

INSERT INTO states(pname, value) 
VALUES 
	('scanner_position', 0),
	('rating_position', 0);
