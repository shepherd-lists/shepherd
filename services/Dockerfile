FROM node:18 as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json tsconfig.json
COPY package*.json ./
RUN npm ci --omit=dev
COPY ./src/common ./src/common

FROM base as webserver
COPY ./src/byte-ranges ./src/byte-ranges
COPY ./src/webserver ./src/webserver
RUN npm run typecheck
ENTRYPOINT node -r ts-node/register src/webserver/index.ts

FROM base as http-api
COPY ./src/byte-ranges ./src/byte-ranges
COPY ./src/http-api ./src/http-api
RUN npm run typecheck
ENTRYPOINT node -r ts-node/register src/http-api/index.ts

FROM base as indexer
COPY ./migrations ./migrations
COPY ./seeds ./seeds
COPY ./src/indexer ./src/indexer
RUN npm run typecheck
ENTRYPOINT node -r ts-node/register src/indexer/index.ts

FROM base as feeder
COPY ./src/feeder ./src/feeder
RUN npm run typecheck
ENTRYPOINT node -r ts-node/register src/feeder/index.ts

FROM base as fetchers
COPY ./src/fetchers ./src/fetchers
RUN npm run typecheck
ENTRYPOINT node -r ts-node/register src/fetchers/index.ts
