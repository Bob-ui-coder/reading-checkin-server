FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN addgroup -S app && adduser -S app -G app
COPY . .
USER app
EXPOSE 3000
CMD ["node", "server.js"]
