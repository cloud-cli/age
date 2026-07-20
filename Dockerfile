FROM ghcr.io/cloud-cli/node:latest

RUN apt update && apt install gradle -y

WORKDIR /home/app
COPY . .
RUN pnpm i
RUN ./node_modules/.bin/tsc || true