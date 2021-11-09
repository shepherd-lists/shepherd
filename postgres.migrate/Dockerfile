FROM node:14

RUN npm install -g knex ts-node
WORKDIR /app
COPY . .
RUN npm ci

ENTRYPOINT knex migrate:latest
# ENTRYPOINT [ "ts-node", "index.ts" ]