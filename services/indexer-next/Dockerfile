FROM node:20-slim as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
# COPY tsconfig.json tsconfig.json
COPY package*.json ./
RUN npm ci --omit=dev

FROM base as index-next
COPY ./src/ ./src
RUN npx tsc --noEmit
ENTRYPOINT npx tsx ./src/index.ts
