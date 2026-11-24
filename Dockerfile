

# Stage 1: install npm dependencies.
FROM node:22-bookworm AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Stage 2: install Chromium and its system libraries.
FROM node:22-bookworm AS browser

ARG PLAYWRIGHT_VERSION=1.63.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

# Some host VPN routes block plain HTTP to Debian's CDN.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' \
    /etc/apt/sources.list.d/debian.sources \
    && rm -f /etc/apt/apt.conf.d/docker-clean \
    && printf '%s\n' 'Acquire::Retries "3";' \
       'Acquire::https::Timeout "20";' 'Acquire::http::Timeout "20";' \
       'APT::Update::Error-Mode "any";' \
       'Binary::apt::APT::Keep-Downloaded-Packages "true";' \
       > /etc/apt/apt.conf.d/80-build-downloads

RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    npx --yes playwright@${PLAYWRIGHT_VERSION} \
    install-deps chromium

# Preserve completed browser downloads when a later CDN download is interrupted.
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/ms-playwright \
    PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
    npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium \
    && mkdir -p /opt/playwright \
    && cp -a /root/.cache/ms-playwright/. /opt/playwright/

RUN rm -rf /root/.npm

# Final stage: combine the independent build results.
FROM browser AS runtime

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src

RUN mkdir -p out

CMD ["node", "src/index.js"]
