FROM node:22-alpine
WORKDIR /app
COPY server.js db.js migreer-json.js snack.js backup-db.js ./
EXPOSE 80
CMD ["node", "server.js"]
