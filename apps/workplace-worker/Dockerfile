# === Stage 1: Build ===
# LibreOffice(.doc/.ppt/.xls/.hwp 변환) 를 런타임에서 써야 하므로 이 워커만 DHI distroless
# 정책에서 예외로 빠진다(#735) — soffice 바이너리·폰트가 필요한데 distroless 에는
# 셸/패키지매니저가 없어 apt-get 으로 LibreOffice 를 설치할 방법이 없다.
# venv 는 인터프리터 경로에 종속되므로 빌드/런타임 베이스를 python:3.12-slim 계열로 맞춘다
# (DHI 예외 없이 stock python 을 쓰되, 빌드·런타임 둘 다 동일 slim 이미지 계열이라 경로가 일치한다).
FROM python:3.12-slim-trixie AS build

WORKDIR /app

RUN apt-get update && apt-get install --no-install-recommends -y python3-venv \
    && rm -rf /var/lib/apt/lists/*

# venv 에 런타임 의존만 설치(dev 그룹·FlagEmbedding 등 무거운 옵션 제외 — 기존 이미지 동작 보존).
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pymupdf python-docx openpyxl httpx python-pptx

COPY app ./app

# === Stage 2: Runtime ===
# debian-slim(nonroot 수동 구성) — LibreOffice headless + 한글 폰트 필요.
FROM python:3.12-slim-trixie

WORKDIR /app

# LibreOffice(문서/프레젠테이션/스프레드시트) + 한글 폰트(nanum). --no-install-recommends 로
# 불필요한 GUI 의존을 제외해 이미지 크기를 억제한다.
RUN apt-get update && apt-get install --no-install-recommends -y \
      libreoffice-core libreoffice-writer libreoffice-impress libreoffice-calc fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

# 기존 DHI 이미지와 동일하게 nonroot(UID 65532)로 실행한다.
RUN useradd --uid 65532 --no-create-home --shell /usr/sbin/nologin nonroot

COPY --from=build --chown=65532:65532 /app/.venv /app/.venv
COPY --from=build --chown=65532:65532 /app/app /app/app

USER 65532

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 7080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7080"]
