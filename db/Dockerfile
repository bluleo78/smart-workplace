# dhi.io/postgres:18-debian13 (hardened runtime, 빌드도구 없음)엔 pgvector 미포함.
# -dev 이미지에서 소스 빌드 후 런타임 이미지로 산출물만 복사(멀티스테이지).
#
# 빌드(-dev)·런타임 이미지는 같은 PG 마이너 릴리스로 태그+digest 고정한다(WP-81).
# 떠다니는 18-debian13 태그는 2026-09 에 설치 레이아웃이 /opt/postgresql/18 → /usr/lib/postgresql/18
# 로 바뀌었고, 두 이미지를 다른 시점에 받으면 레이아웃·ABI 가 어긋날 수 있다.
# 올릴 때는 두 값을 같은 릴리스로 함께 교체한다(digest: docker buildx imagetools inspect <image>).
ARG PG_BUILD_IMAGE=dhi.io/postgres:18.6-debian13-dev@sha256:890cb7b12cf5064455c7a9830c1a9e02517d038349c577418b417c0e7c7ca06b
ARG PG_RUNTIME_IMAGE=dhi.io/postgres:18.6-debian13@sha256:63836d2fab4781db2f073b4e64c6f4cf1ce8042d2d894f62df54bf4ba2b63daf

FROM ${PG_BUILD_IMAGE} AS build

ARG PGVECTOR_VERSION=0.8.5

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

# 설치 위치를 경로로 박아두지 않고 pg_config 로 읽어 고정 스테이징 경로에 모은다.
# 베이스 이미지 레이아웃이 바뀌어도(WP-81) 런타임 COPY 는 영향받지 않는다.
RUN PKGLIB="/tmp/pgvector-out$(/opt/postgresql/18/bin/pg_config --pkglibdir)" \
    && SHARE="/tmp/pgvector-out$(/opt/postgresql/18/bin/pg_config --sharedir)" \
    && mkdir -p /tmp/pgvector-stage/lib /tmp/pgvector-stage/extension \
    && cp "$PKGLIB/vector.so" /tmp/pgvector-stage/lib/ \
    && cp "$SHARE"/extension/vector* /tmp/pgvector-stage/extension/

FROM ${PG_RUNTIME_IMAGE}

# 런타임 이미지의 /opt/postgresql/18/{lib,share} 는 실제 설치 위치를 가리키므로(디렉터리든 심볼릭 링크든) 그대로 쓴다.
COPY --from=build /tmp/pgvector-stage/lib/vector.so /opt/postgresql/18/lib/vector.so
COPY --from=build /tmp/pgvector-stage/extension/ /opt/postgresql/18/share/extension/
