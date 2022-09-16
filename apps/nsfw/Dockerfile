FROM rosmcmahon/node16-ffmpeg:multi-arch

# create app directory
WORKDIR /app
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENV TF_ENABLE_ONEDNN_OPTS: '1'
COPY ./package*.json ./
RUN npm ci --omit=dev

COPY ./src/common ./src/common
COPY ./src/nsfw ./src/nsfw
ENTRYPOINT node -r ts-node/register src/nsfw/index.ts
