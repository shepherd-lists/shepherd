FROM node:22-slim AS base
# turn off the nuisance nodejs update message
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false

# install dependencies for node-gyp and ffmpeg
RUN apt-get update && apt-get install -y \
	ffmpeg \
	python3 \
	make \
	g++ \
	&& rm -rf /var/lib/apt/lists/* 

FROM base AS builder
WORKDIR /app/nsfw
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENV TF_ENABLE_ONEDNN_OPTS=1
COPY ./nsfw/package*.json ./
COPY ./nsfw/tsconfig.json ./tsconfig.json
COPY ./classifier-host ../classifier-host
COPY ./services/libs ../services/libs
RUN npm ci --omit=dev

FROM builder AS nsfw
# install additional NSFW dependencies
RUN npm i shepherd-plugin-nsfw
RUN npm rebuild @tensorflow/tfjs-node --build-from-source
COPY ./nsfw/src ./src
COPY ./nsfw/shepherd.config.json ./shepherd.config.json
RUN npm run typecheck
ENTRYPOINT ["npx", "tsx", "src/index.ts"]

FROM builder AS no-nsfw
COPY ./nsfw/src ./src
COPY ./nsfw/shepherd.config.json ./shepherd.config.json
RUN npm run typecheck
ENTRYPOINT ["npx", "tsx", "src/index.ts"]