FROM ghcr.io/cloud-cli/node:latest

USER 0
RUN apk update && apk add --allow-untrusted openjdk21-jdk gradle
COPY entrypoint.sh /entrypoint.sh
WORKDIR /home/app
COPY . .
RUN pnpm i && ./node_modules/.bin/tsc || true
ENTRYPOINT ["sh"]
CMD ["/entrypoint.sh"]
