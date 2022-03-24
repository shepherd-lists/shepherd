FROM node:14 as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
ENV NODE_ENV=production

FROM base as web
COPY . .
ENTRYPOINT node -r ts-node/register src/$PROCESS_NAME/index.ts

FROM base as scanner
COPY . .
ENTRYPOINT node -r ts-node/register src/$PROCESS_NAME/index.ts

FROM base as feeder
COPY ./src/feeder ./src/feeder
COPY ./src/types.ts ./src/
COPY ./src/utils ./src/utils
ENTRYPOINT node -r ts-node/register src/feeder/index.ts

FROM base as fetchers
COPY ./src/fetchers ./src/fetchers
ENTRYPOINT node -r ts-node/register src/fetchers/index.ts

FROM rosmcmahon/node14-ffmpeg:multi-arch as rating
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENTRYPOINT node -r ts-node/register src/rating/index.ts