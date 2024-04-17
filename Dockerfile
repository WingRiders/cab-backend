FROM oven/bun:alpine as base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# tests & build
RUN bun test

# copy production dependencies and source code into final image
FROM base as release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/drizzle drizzle
COPY --from=prerelease /usr/src/app/src src
COPY --from=prerelease /usr/src/app/package.json .
COPY healthcheck.sh /usr/src/app/healthcheck.sh

# define healthcheck
HEALTHCHECK --start-period=10s --interval=30s --retries=10 CMD /usr/src/app/healthcheck.sh

# run the app
USER bun
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000/tcp
CMD [ "./src/index.ts" ]
