FROM node:20-slim as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json tsconfig.json

FROM base as indexer-next
ARG targetArg # same value as target
COPY services/${targetArg}/package*.json ./
RUN npm ci --omit=dev -c services/${targetArg} 
COPY ./services/${targetArg}/migrations ./service/migrations
COPY ./services/${targetArg}/src ./service/src
RUN (cd ./service && npx tsc --noEmit)
ENTRYPOINT npx tsx ./service/src/index.ts

FROM base as webserver-next
ARG targetArg 
COPY services/${targetArg}/package*.json ./
RUN npm ci --omit=dev -c services/${targetArg}
COPY ./services/${targetArg}/src ./service/src
RUN (cd ./service && npx tsc --noEmit)
ENTRYPOINT npx tsx ./service/src/index.ts
