FROM ghcr.io/cloud-cli/node:latest

USER 0
RUN apk update && apk add openjdk17 gradle

WORKDIR /home/app
COPY . .
RUN pnpm i
RUN ./node_modules/.bin/tsc || true