# === Stage 1: Build ===
# 정책 A(런타임만 DHI)의 예외 — 빌드도 DHI python 을 쓴다:
# venv 는 인터프리터 경로(/usr/bin/python3)에 종속되므로 런타임과 동일한 DHI python(-dev)으로
# 빌드해야 venv 가 그대로 이식된다. stock python:3.12-slim(/usr/local/bin)은 DHI 런타임에서 깨진다.
FROM dhi.io/python:3.12-debian13-dev AS build

WORKDIR /app

# venv 에 런타임 의존만 설치(dev 그룹·FlagEmbedding 등 무거운 옵션 제외 — 기존 이미지 동작 보존).
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pymupdf python-docx openpyxl httpx

COPY app ./app

# === Stage 2: Runtime ===
# DHI 하드닝 런타임(distroless) — shell/패키지매니저 없음, nonroot(UID 65532) 기본.
FROM dhi.io/python:3.12-debian13

WORKDIR /app
# distroless라 RUN chown 불가 → COPY 시 nonroot(65532) 소유로 복사
COPY --from=build --chown=65532:65532 /app/.venv /app/.venv
COPY --from=build --chown=65532:65532 /app/app /app/app

USER 65532

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 7080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7080"]
