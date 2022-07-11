FROM node:16 as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev

FROM base as web
COPY ./src/common ./src/common
COPY ./src/$PROCESS_NAME ./src/$PROCESS_NAME
ENTRYPOINT node -r ts-node/register src/$PROCESS_NAME/index.ts

FROM base as scanner
COPY ./migrations ./migrations
COPY ./seeds ./seeds
COPY ./src/common ./src/common
COPY ./src/scanner ./src/scanner
ENTRYPOINT node -r ts-node/register src/scanner/index.ts

FROM base as feeder
COPY ./src/common ./src/common
COPY ./src/feeder ./src/feeder
ENTRYPOINT node -r ts-node/register src/feeder/index.ts

FROM base as fetchers
COPY ./src/common ./src/common
COPY ./src/fetchers ./src/fetchers
ENTRYPOINT node -r ts-node/register src/fetchers/index.ts

FROM rosmcmahon/node16-ffmpeg:multi-arch as rating
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENTRYPOINT node -r ts-node/register src/rating/index.ts