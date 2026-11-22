# Stage 1: Build ultra-lean Rust binary
FROM rust:1-slim-bookworm AS builder

WORKDIR /build
COPY rust_extractor/Cargo.toml rust_extractor/Cargo.lock ./
COPY rust_extractor/src ./src

RUN cargo build --release

# Stage 2: Minimal runtime image (~25MB disk, ~3MB RAM)
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/avs_direct_m3u8 /app/avs_direct_m3u8

ENV PORT=8095
EXPOSE 8095

CMD ["/app/avs_direct_m3u8", "--serve"]
