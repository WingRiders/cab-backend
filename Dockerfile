FROM oven/bun:alpine as base

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
WORKDIR /temp/prod
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# copy production dependencies and source code into final image
FROM base as release
WORKDIR /usr/src/app
COPY --from=install /temp/prod/node_modules node_modules
COPY drizzle drizzle
COPY src src
COPY package.json .
COPY healthcheck.sh /usr/src/app/healthcheck.sh

# define healthcheck
HEALTHCHECK --start-period=10s --interval=30s --retries=10 CMD /usr/src/app/healthcheck.sh

# Add the RDS certificate to the system
RUN apk add --no-cache ca-certificates=20241121-r1
COPY ca-certificates/rds-global-bundle.pem /usr/local/share/ca-certificates/rds.crt
RUN update-ca-certificates

# run the app
USER bun
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000/tcp
CMD [ "./src/index.ts" ]
