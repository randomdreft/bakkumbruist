FROM node:22-alpine
WORKDIR /app
COPY server.js .
EXPOSE 80
CMD ["node", "server.js"]
