FROM node:18-slim

# turn off the nuisance nodejs update message 
ARG NO_UPDATE_NOTIFIER=true
ENV NO_UPDATE_NOTIFIER=true
RUN npm config set update-notifier false

# since we are using slim we need to install some extra stuff for node-gyp as well as ffmpeg
RUN apt update && apt install -y ffmpeg python3 make g++ && rm -rf /var/lib/apt/lists/*
