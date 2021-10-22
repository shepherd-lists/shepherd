FROM node:14 as base

# turn off the nuisance update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false

# install ffmpeg dependency
RUN apt update 
RUN apt install ffmpeg -y

# create app directory
WORKDIR /app

FROM base as prod
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 80
ENV NODE_ENV=production
ENV TF_CPP_MIN_LOG_LEVEL=2
ENTRYPOINT node -r ts-node/register src/$PROCESS_NAME/index.ts