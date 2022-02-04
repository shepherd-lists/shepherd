#! /bin/bash
echo 'Warning this will change your docker build system'
docker buildx install
docker buildx create --use --name shepbuild
docker buildx build --push --tag rosmcmahon/node14-ffmpeg:multi-arch --platform linux/amd64,linux/arm64 . 
# docker buildx rm shepbuild