SELECT 'CREATE DATABASE arblacklist'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'arblacklist')\gexec