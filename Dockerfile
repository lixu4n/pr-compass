FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:all

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
# Official IBM installer, optional because the OpenAI provider needs no Bob process.
# Runtime preflight refuses any Bob version other than verified 2.0.5.
ARG INSTALL_BOB=false
RUN if [ "$INSTALL_BOB" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates bash && \
      curl -fsSL https://bob.ibm.com/download/bobshell.sh -o /tmp/bobshell.sh && \
      bash /tmp/bobshell.sh --pm npm --version 2.0.5 && command -v bob && bob --version && \
      rm /tmp/bobshell.sh && rm -rf /var/lib/apt/lists/*; \
    fi
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 COMPASS_DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server-dist/index.mjs"]
