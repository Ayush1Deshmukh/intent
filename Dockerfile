# Verified Tape — one image, no hosting account required.
#
# Three stages, so what ships has no build toolchain in it at all:
#   deps    install once, cached on package-lock.json alone
#   build   compile the Next.js standalone server, and bundle the setup step
#           (migrations + seed) into a single self-contained setup.cjs
#   run     those two artifacts and nothing else
#
# Bundling the setup step is what makes the runtime stage small and, more to the
# point, correct: the earlier version copied drizzle-kit, tsx and esbuild across by
# hand and then failed at start because the platform-specific esbuild binary was
# not on that hand-written list. A compiled script has no such list.

FROM node:22-alpine AS deps
WORKDIR /app
# Pin npm to the major that wrote package-lock.json. node:22-alpine ships npm 10,
# which resolves some optional wasm bindings differently and then refuses the lock
# as out of sync — a confusing failure that has nothing to do with this project.
RUN npm i -g npm@11 --no-fund --no-audit
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Needed only because env.ts validates at import time. Nothing connects during the
# build; the real values arrive at runtime from docker-compose.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:setup

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache curl

# the traced Next.js server, plus the compiled setup step alongside it
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# read at runtime by setup.cjs and by the demo tape loader
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/fixtures ./fixtures
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=45s --retries=18 \
  CMD curl -fsS http://localhost:3000/login >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
