FROM node:20-alpine

# Prisma's query/schema engines need OpenSSL at build and runtime; node:alpine
# ships without it, which makes the engine fail to load libssl.
RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json ./
RUN npm install

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Build the TypeScript sources
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime entrypoint (strip any CRLF so the shebang works on Alpine)
COPY docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
