FROM node:20-alpine AS build
WORKDIR /app
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json ./
RUN npm install --omit=dev
RUN apk add --no-cache openssl
COPY database/ database/
RUN npx --yes prisma@5 generate --schema=database/schema.prisma
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["sh", "-c", "npx --yes prisma@5 db push --schema=database/schema.prisma --skip-generate && exec node dist/main"]
