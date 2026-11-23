# Stage 1: Build the exported web app independently from Rust sources
FROM node:22-alpine AS web-builder

WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build the lean Rust engine
FROM rust:1-slim-bookworm AS rust-builder

WORKDIR /build
COPY rust_extractor/Cargo.toml rust_extractor/Cargo.lock ./
COPY rust_extractor/src ./src

RUN cargo build --release

# Stage 3: Minimal runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=rust-builder /build/target/release/avs_direct_m3u8 /app/avs_direct_m3u8
COPY --from=web-builder /build/web/out /app/web

ENV PORT=8095
ENV WEB_ROOT=/app/web
EXPOSE 8095

CMD ["/app/avs_direct_m3u8", "--serve"]
