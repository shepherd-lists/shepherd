FROM rosmcmahon/node16-ffmpeg:multi-arch

# create app directory
WORKDIR /app
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENV TF_ENABLE_ONEDNN_OPTS: '1'
COPY ./tsconfig.json ./tsconfig.json
COPY ./package*.json ./
RUN npm ci --omit=dev

COPY ./src ./src
ENTRYPOINT node -r ts-node/register src/index.ts
