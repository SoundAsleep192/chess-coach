# Сервис движка: Stockfish из исходников (тег той же версии, что на хосте) и пул UCI-процессов на Nest.
# Контекст сборки - каталог web/: docker compose build --pull=false engine

FROM node:24.21.0-alpine AS sf
ARG TARGETARCH
ARG SF_TAG=sf_19
RUN apk add --no-cache g++ make wget
WORKDIR /sf
RUN wget -q -O sf.tar.gz "https://github.com/official-stockfish/Stockfish/archive/refs/tags/${SF_TAG}.tar.gz" \
 && tar -xzf sf.tar.gz \
 && mv "Stockfish-${SF_TAG}" src-tree
WORKDIR /sf/src-tree/src
# Имена целей проверены по Makefile тега sf_19: armv8-dotprod (arm64) и x86-64-avx2 (amd64).
# Цель build сначала делает net: scripts/net.sh скачивает каждую сеть из evaluate.h (в sf_19 одна: nn-1a298aa575a0.nnue) и проверяет sha256.
# Запасной вариант: если net.sh не достанет сеть, сначала скачиваем вручную все сети, названные в evaluate.h
# (net.sh проверит sha256 готового файла и пропустит загрузку; сбой предзагрузки не фатален, net.sh повторит сам).
RUN case "$TARGETARCH" in \
      arm64) SF_ARCH=armv8-dotprod ;; \
      amd64) SF_ARCH=x86-64-avx2 ;; \
      *) echo "unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac \
 && for NET in $(grep '#define EvalFileDefaultName' evaluate.h | sed -n 's/.*\(nn-[a-z0-9]\{12\}\.nnue\).*/\1/p'); do \
      [ -f "$NET" ] || wget -q -O "$NET" "https://tests.stockfishchess.org/api/nn/$NET" \
      || wget -q -O "$NET" "https://github.com/official-stockfish/networks/raw/master/$NET" \
      || rm -f "$NET"; \
    done \
 && make -j"$(nproc)" build ARCH="$SF_ARCH" \
 && strip stockfish \
 && printf 'uci\nquit\n' | ./stockfish | grep -q '^id name Stockfish'

FROM node:24.21.0-alpine AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/puzzles/package.json packages/puzzles/
COPY packages/engine/package.json packages/engine/
RUN npm ci
COPY packages/shared packages/shared
COPY packages/engine packages/engine
RUN npm run build -w @board/engine

FROM node:24.21.0-alpine
RUN apk add --no-cache libstdc++
WORKDIR /app
ENV NODE_ENV=production MONGOMS_DISABLE_POSTINSTALL=1 HOST=0.0.0.0 PORT=8766 ENGINE_PATH=/usr/local/bin/stockfish
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/puzzles/package.json packages/puzzles/
COPY packages/engine/package.json packages/engine/
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/shared/src packages/shared/src
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=sf /sf/src-tree/src/stockfish /usr/local/bin/stockfish
USER node
EXPOSE 8766
CMD ["node", "packages/engine/dist/main.js"]
