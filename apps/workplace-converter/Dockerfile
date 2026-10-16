# workplace-converter 이미지 (WP-430).
#
# 스테이지:
#   build     — uv.lock 기준 런타임 의존만 venv(/app/.venv)에 설치
#   build-dev — build venv 에 dev 그룹(pytest·httpx·python-pptx·python-docx·openpyxl) 추가
#   rhwp      — TARGETARCH 에 맞는 rhwp v0.8.7 Linux 바이너리를 받아 sha256 검증
#   base      — LibreOffice·python3-uno·rsvg-convert·폰트·rhwp·nonroot 사용자(runtime·test 공통)
#   test      — base + dev 의존 venv + tests/ 로 `pytest -q`(engine 마커 포함 전체) — 빌드 성공 = 전체 통과
#   runtime   — base + 런타임 venv + app/. 맨 끝에 두어 `docker build` 기본 타깃이 된다
#
# 왜 distroless 가 아닌가: LibreOffice(soffice)·python3-uno·rsvg-convert·폰트를 apt 로 깔아야 해서
# 워커와 같은 python:3.12-slim-trixie 를 쓴다. venv 는 인터프리터 경로(/usr/local/bin/python3.12)에 종속되므로
# 빌드·런타임 베이스를 같은 이미지로 맞춘다.

# === build: 런타임 의존 venv ===
FROM python:3.12-slim-trixie AS build

WORKDIR /app

# uv 로 lock 파일 그대로 설치해 로컬(uv sync)과 같은 버전을 보장한다
RUN pip install --no-cache-dir uv==0.11.10
ENV UV_PROJECT_ENVIRONMENT=/app/.venv UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# === build-dev: test 스테이지용 dev 의존 추가 ===
FROM build AS build-dev
RUN uv sync --frozen --no-install-project

# === rhwp: 아키텍처별 바이너리 다운로드 + 무결성 검증 ===
FROM python:3.12-slim-trixie AS rhwp

# buildx 가 채우는 대상 아키텍처(amd64·arm64). 단독 `docker build` 에서도 호스트 아키로 채워진다.
ARG TARGETARCH
ARG RHWP_VERSION=v0.8.7
# 릴리스 SHA256SUMS.txt 의 tar.gz 해시(Global Constraints 고정값). 버전을 올릴 때 함께 갱신한다.
ARG RHWP_SHA256_AARCH64=c4a70f5ed11b99586ee89d1ac9069145d58a0831d00e87858bb01626e2ebf313
ARG RHWP_SHA256_X86_64=f1e541a25cfe76b6bc1daf18bf9c1f9a5ac5e03e2c01b188daaf54107214f631

RUN apt-get update && apt-get install --no-install-recommends -y curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /dl
# TARGETARCH → rhwp 자산 아키 이름 매핑(amd64→x86_64, arm64→aarch64). 그 외 아키는 즉시 실패.
RUN set -eu; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) arch=x86_64;  sha="$RHWP_SHA256_X86_64" ;; \
      arm64) arch=aarch64; sha="$RHWP_SHA256_AARCH64" ;; \
      *) echo "지원하지 않는 아키텍처: ${TARGETARCH:-?}" >&2; exit 1 ;; \
    esac; \
    asset="rhwp-${RHWP_VERSION}-linux-${arch}.tar.gz"; \
    curl -fsSL -o "$asset" "https://github.com/edwardkim/rhwp/releases/download/${RHWP_VERSION}/${asset}"; \
    echo "${sha}  ${asset}" | sha256sum -c -; \
    tar xzf "$asset"; \
    install -m 0755 rhwp/rhwp /dl/rhwp-bin

# === base: runtime·test 공통 레이어 ===
# test 가 runtime 과 같은 시스템 구성을 쓰면서도 기본 타깃(마지막 스테이지)은 runtime 이 되도록 공통부를 분리한다.
FROM python:3.12-slim-trixie AS base

WORKDIR /app

# LibreOffice(Writer·Impress·Calc 가져오기) + python3-uno(시스템 파이썬용 UNO 헬퍼) + rsvg-convert(SVG→PDF)
# + fontconfig + 폰트. fonts-noto-cjk 는 크기(수백 MB) 때문에 금지 — 한글은 나눔, MS 기본 서체는 메트릭 호환 대체.
RUN apt-get update && apt-get install --no-install-recommends -y \
      libreoffice-core libreoffice-writer libreoffice-impress libreoffice-calc python3-uno \
      librsvg2-bin fontconfig tini \
      fonts-nanum fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

COPY --from=rhwp /dl/rhwp-bin /usr/local/bin/rhwp

# 워커와 동일한 nonroot(UID 65532)
RUN useradd --uid 65532 --no-create-home --shell /usr/sbin/nologin nonroot

# 운영은 readOnlyRootFilesystem + /tmp tmpfs(emptyDir) 전제 — 홈(LibreOffice 프로필·fontconfig 캐시)과
# 임시 파일을 모두 /tmp 로 몰아 쓰기 가능한 곳은 /tmp 하나뿐이게 한다.
ENV HOME=/tmp TMPDIR=/tmp PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

EXPOSE 7085

# tini 를 PID 1 로 둔다: 변환 마감 초과·재기동으로 kill 한 soffice.bin 은 부모가 끝나면 PID 1 의 자식으로 입양되는데,
# PID 1 이 uvicorn(runtime)·pytest(test)면 wait() 하지 않아 좀비가 파드 수명 내내 쌓인다. tini 가 이를 회수한다.
# base 에 두어 runtime·test(docker run) 모두 상속한다. 빌드 중 RUN 에는 영향이 없다.
ENTRYPOINT ["/usr/bin/tini", "--"]

# === test: 엔진 포함 전체 테스트 (빌드 성공 = PASS) ===
FROM base AS test

COPY --from=build-dev --chown=65532:65532 /app/.venv /app/.venv
COPY --chown=65532:65532 pyproject.toml ./
COPY --chown=65532:65532 app ./app
COPY --chown=65532:65532 tests ./tests

USER 65532
# 캐시 플러그인은 /app 에 .pytest_cache 를 쓰려 하므로 끈다(운영과 같은 쓰기 제약 유지)
RUN pytest -q -p no:cacheprovider

# === runtime (기본 타깃) ===
FROM base AS runtime

COPY --from=build --chown=65532:65532 /app/.venv /app/.venv
COPY --chown=65532:65532 app ./app

USER 65532

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7085"]
