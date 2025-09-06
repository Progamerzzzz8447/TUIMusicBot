# All-in-one: Node (bot) + Java (Lavalink)
FROM node:20-bullseye-slim

# Install Java for Lavalink and small utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps first (cache layer)
COPY package.json ./
RUN npm install --production

# Copy app files
COPY index.js ./
COPY .env.example ./
COPY README.md ./
COPY lavalink/application.yml ./lavalink/application.yml
COPY start.sh ./start.sh
RUN chmod +x /app/start.sh

# Download latest Lavalink jar at build time
RUN mkdir -p /app/lavalink && \
    curl -L -o /app/lavalink/Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar

# Expose Lavalink port (not strictly required for worker processes)
EXPOSE 2333

# Start Lavalink first, then the bot
CMD ["/app/start.sh"]
