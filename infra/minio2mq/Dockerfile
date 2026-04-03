FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY *.ts .
CMD ["npx", "tsx", "index.ts"]
