# syntax=docker/dockerfile:1

# Stage 1: install npm dependencies.
FROM node:22-bookworm AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Stage 2: install Chromium and its system libraries.
FROM node:22-bookworm AS browser

ARG PLAYWRIGHT_VERSION=1.63.0

RUN --mount=type=cache,target=/root/.npm \
    npx --yes playwright@${PLAYWRIGHT_VERSION} \
    install --with-deps chromium

RUN rm -rf /root/.npm

# Final stage: combine the independent build results.
FROM browser AS runtime

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src

RUN mkdir -p out

CMD ["node", "src/index.js"]
