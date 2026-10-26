# Reproducible local build and Worker preview. Uploaded games and D1/R2 state
# remain runtime data; this image only contains the application and its assets.
FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:all

FROM node:24.18.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./

EXPOSE 8787
CMD ["npm", "run", "dev:full", "--", "--ip", "0.0.0.0"]
