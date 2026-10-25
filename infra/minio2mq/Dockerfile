FROM node:22.23.4-bookworm-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY *.ts .
CMD ["npx", "tsx", "index.ts"]
