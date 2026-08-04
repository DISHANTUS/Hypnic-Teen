# For any host that takes a container (Fly, Railway, a VPS).
#
#   docker build -t hypnic .
#   docker run -p 8008:8008 -v hypnic-data:/data -e DATA_DIR=/data hypnic
#
# Mount a volume at DATA_DIR — that is where accounts, points and titles live.

FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8008
ENV DATA_DIR=/data

WORKDIR /app

# Dependencies first, so a code change doesn't reinstall the world.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN node tools/gen-icons.mjs

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 8008
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
