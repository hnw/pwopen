# syntax=docker/dockerfile:1.6

FROM mcr.microsoft.com/playwright:v1.58.2-noble AS base

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Create a non-root user for runtime
ARG UID=10001
ARG GID=10001
RUN groupadd -g ${GID} app \
    && useradd -m -u ${UID} -g ${GID} app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules /app/node_modules
COPY tsconfig*.json playwright.config.ts ./
COPY src ./src
RUN npm run build

FROM base AS runtime
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force
COPY --from=build /app/dist /app/dist
RUN chown -R app:app /app
USER app

ENTRYPOINT ["node", "dist/main.js"]
