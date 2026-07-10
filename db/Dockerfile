# dhi.io/postgres:18-debian13 (hardened runtime, 빌드도구 없음)엔 pgvector 미포함.
# -dev 이미지에서 소스 빌드 후 런타임 이미지로 산출물만 복사(멀티스테이지).
FROM dhi.io/postgres:18-debian13-dev AS build

ARG PGVECTOR_VERSION=0.8.1

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch v${PGVECTOR_VERSION} --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector
WORKDIR /tmp/pgvector
# with_llvm=no: JIT용 LLVM bitcode(clang) 빌드 스킵 — 이미지에 clang 미포함, 확장 동작엔 불필요
# OPTFLAGS="": pgvector 기본 -march=native 제거. deploy.sh 는 buildx/QEMU 로 amd64 를 빌드하는데,
# 빌드 CPU 에 맞춘 명령어가 운영 호스트에 없으면 런타임 SIGILL 이 난다(이식성 위해 CPU 튜닝 해제).
RUN make PG_CONFIG=/opt/postgresql/18/bin/pg_config with_llvm=no OPTFLAGS="" \
    && make install PG_CONFIG=/opt/postgresql/18/bin/pg_config with_llvm=no OPTFLAGS="" DESTDIR=/tmp/pgvector-out

FROM dhi.io/postgres:18-debian13

COPY --from=build /tmp/pgvector-out/opt/postgresql/18/lib/vector.so /opt/postgresql/18/lib/vector.so
COPY --from=build /tmp/pgvector-out/opt/postgresql/18/share/extension/vector* /opt/postgresql/18/share/extension/
