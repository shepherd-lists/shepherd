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

ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENV TF_ENABLE_ONEDNN_OPTS=1

# nsfw harness deps (tsx/typescript) — rarely changes, isolated branch
FROM base AS nsfw-deps
WORKDIR /app/nsfw
COPY ./nsfw/package*.json ./
RUN npm ci --omit=dev

# classifier-host deps + native tfjs build — trunk of the final image.
# Sibling of nsfw-deps off `base`, so nsfw lockfile changes don't bust the
# expensive tfjs rebuild (and vice versa).
FROM base AS host-build
WORKDIR /app/classifier-host
COPY ./classifier-host/package*.json ./
RUN npm ci --omit=dev
RUN npm i shepherd-plugin-nsfw@latest
RUN npm rebuild @tensorflow/tfjs-node --build-from-source

# Volatile tail: a single continuous pipeline. classifier-host src changes
# most often, so it is copied last among the source trees before typecheck.
FROM host-build AS nsfw
WORKDIR /app/nsfw
COPY --from=nsfw-deps /app/nsfw/node_modules ./node_modules
COPY ./nsfw/tsconfig.json ./tsconfig.json
COPY ./classifier-host/tsconfig.json /app/classifier-host/tsconfig.json
COPY ./nsfw/src ./src
COPY ./nsfw/shepherd.config.json ./shepherd.config.json
COPY ./classifier-host/src /app/classifier-host/src
RUN ["npx", "tsc", "--noEmit"]
ENTRYPOINT ["npx", "tsx", "src/index.ts"]
