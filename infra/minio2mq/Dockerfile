FROM node:26.13.1-bookworm-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY *.ts .
CMD ["npx", "tsx", "index.ts"]
