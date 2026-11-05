FROM node:22-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /data/uploads
ENV DB_PATH=/data/claims.db UPLOAD_DIR=/data/uploads
CMD ["node","dist/server.js"]
