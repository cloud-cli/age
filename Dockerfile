FROM ghcr.io/cloud-cli/node:latest

USER 0
RUN apk update && apk add openjdk17 gradle
USER 1000

WORKDIR /home/app
COPY . .
RUN pnpm i
RUN ./node_modules/.bin/tsc || true