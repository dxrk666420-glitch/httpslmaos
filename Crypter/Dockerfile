FROM oven/bun:1 AS base
WORKDIR /app

# Install Go (needed to compile cryptToExe stubs) and Java (needed for cryptToJar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    golang-go \
    default-jdk \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY public ./public

EXPOSE 7641
CMD ["bun", "run", "src/index.ts"]
