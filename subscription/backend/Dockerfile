# DB Player 订阅 API - 阿里云 FC Custom Container
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY src ./src
COPY schema.sql ./

# FC 默认监听 9000 端口
ENV PORT=9000
EXPOSE 9000

CMD ["bun", "run", "src/index.ts"]
