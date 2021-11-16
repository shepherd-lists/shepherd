FROM node:14 as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production


FROM base as rating
# install ffmpeg dependency
RUN apt update && apt install ffmpeg -y
ENV TF_CPP_MIN_LOG_LEVEL=2
ENTRYPOINT node -r ts-node/register src/rating/index.ts

FROM base as web
ENTRYPOINT node -r ts-node/register src/$PROCESS_NAME/index.ts

FROM base as scanner
RUN npm install -g knex ts-node
ENTRYPOINT knex migrate:latest && node -r ts-node/register src/$PROCESS_NAME/index.ts