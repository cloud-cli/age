FROM ghcr.io/cloud-cli/node:latest

USER 0
RUN apk update && apk add --allow-untrusted openjdk21-jdk gradle

WORKDIR /home/app
COPY . .
RUN pnpm i
RUN ./node_modules/.bin/tsc || true
RUN chmod +x entrypoint.sh
ENTRYPOINT ["/home/app/entrypoint.sh"]
