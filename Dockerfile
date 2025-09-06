FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless curl ca-certificates bash netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./
COPY .env.example ./
COPY README.md ./
COPY lavalink/application.yml ./lavalink/application.yml
COPY start.sh ./start.sh
RUN chmod +x /app/start.sh

RUN mkdir -p /app/lavalink && \
    curl -L -o /app/lavalink/Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar

EXPOSE 2333
CMD ["/app/start.sh"]
