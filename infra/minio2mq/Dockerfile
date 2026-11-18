FROM node:22.23.5-bookworm-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY *.ts .
CMD ["npx", "tsx", "index.ts"]
