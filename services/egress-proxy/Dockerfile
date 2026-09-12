# syntax=docker/dockerfile:1.7
FROM node:20-alpine
WORKDIR /app
COPY proxy.js ./
USER node
CMD ["node", "proxy.js"]
