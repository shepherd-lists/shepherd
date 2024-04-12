FROM node:20-slim as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json tsconfig.json
COPY types.d.ts types.d.ts
# this is for shared code installed as relative package
COPY ./libs ./libs
WORKDIR /app/libs
RUN npm ci --omit=dev

FROM base as indexer-next
ARG targetArg # same value as target
WORKDIR /app/services/${targetArg}
# need same folder depth
COPY ./services/${targetArg}/package*.json ./
RUN npm ci --omit=dev
COPY ./services/${targetArg}/migrations ./migrations 
COPY ./services/${targetArg}/src ./src
RUN npx tsc --noEmit
ENTRYPOINT npx tsx ./src/index.ts

FROM base as webserver-next
ARG targetArg 
WORKDIR /app/services/${targetArg}
COPY services/${targetArg}/package*.json ./
RUN npm ci --omit=dev
COPY ./services/${targetArg}/src ./src
RUN npx tsc --noEmit
ENTRYPOINT npx tsx ./src/index.ts

FROM base as http-api
ARG targetArg 
WORKDIR /app/services/${targetArg}
COPY services/${targetArg}/package*.json ./
RUN npm ci --omit=dev
COPY ./services/${targetArg}/src ./src
RUN npx tsc --noEmit
ENTRYPOINT npx tsx ./src/index.ts

FROM node:20-slim as test
WORKDIR /test
COPY . .