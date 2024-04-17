FROM oven/bun:alpine as base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy production dependencies and source code into final image
FROM base as release
COPY --from=install /temp/prod/node_modules node_modules
COPY drizzle drizzle
COPY src src
COPY package.json .
COPY healthcheck.sh /usr/src/app/healthcheck.sh

# define healthcheck
HEALTHCHECK --start-period=10s --interval=30s --retries=10 CMD /usr/src/app/healthcheck.sh

# run the app
USER bun
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000/tcp
CMD [ "./src/index.ts" ]
