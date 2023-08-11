FROM rosmcmahon/node18-ffmpeg:multi-arch as base

# create app directory
WORKDIR /app
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENV TF_ENABLE_ONEDNN_OPTS: '1'
COPY ./tsconfig.json ./tsconfig.json
COPY ./package*.json ./
RUN npm ci --omit=dev

FROM base as tfjs
RUN npm i shepherd-plugin-nsfw
RUN npm rebuild @tensorflow/tfjs-node --build-from-source
COPY ./src ./src
COPY ./shepherd.config.json ./shepherd.config.json
ENTRYPOINT node -r ts-node/register src/index.ts

FROM base as no-tfjs
COPY ./src ./src
COPY ./shepherd.config.json ./shepherd.config.json
ENTRYPOINT node -r ts-node/register src/index.ts