FROM node:20-slim as base

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false
# create app directory
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json tsconfig.json
# this is for shared code installed as relative package
COPY ./libs ./libs

FROM base as indexer-next
ARG targetArg # same value as target
# need same folder depth
COPY services/${targetArg}/package*.json ./service/app/
RUN npm --prefix ./service/app ci --omit=dev
COPY ./services/${targetArg}/migrations ./service/app/migrations 
COPY ./services/${targetArg}/src ./service/app/src
RUN (cd ./service/app && npx tsc --noEmit)
ENTRYPOINT npx tsx ./service/app/src/index.ts

FROM base as webserver-next
ARG targetArg 
COPY services/${targetArg}/package*.json ./service/app/
RUN npm --prefix ./service/app ci --omit=dev
COPY ./services/${targetArg}/src ./service/app/src
RUN (cd ./service/app && npx tsc --noEmit)
ENTRYPOINT npx tsx ./service/app/src/index.ts
