FROM node:18 as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev

FROM base as webserver
COPY ./src/common ./src/common
COPY ./src/webserver ./src/webserver
ENTRYPOINT node -r ts-node/register src/webserver/index.ts

FROM base as http-api
COPY ./src/common ./src/common
COPY ./src/http-api ./src/http-api
ENTRYPOINT node -r ts-node/register src/http-api/index.ts

FROM base as indexer
COPY ./migrations ./migrations
COPY ./seeds ./seeds
COPY ./src/common ./src/common
COPY ./src/indexer ./src/indexer
ENTRYPOINT node -r ts-node/register src/indexer/index.ts

FROM base as feeder
COPY ./src/common ./src/common
COPY ./src/feeder ./src/feeder
ENTRYPOINT node -r ts-node/register src/feeder/index.ts

FROM base as fetchers
COPY ./src/common ./src/common
COPY ./src/fetchers ./src/fetchers
ENTRYPOINT node -r ts-node/register src/fetchers/index.ts
