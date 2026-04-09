#! /bin/bash

# docker exec -it shepherd-pgdb-1 psql -U postgres arblacklist

docker exec -it postgres-shep-dev psql -U shepherd arblacklist

