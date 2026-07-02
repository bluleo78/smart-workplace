#!/usr/bin/env bash
set -euo pipefail

# Smart Workplace 운영 배포 스크립트
# 이미지를 multiplatform 으로 빌드해 ghcr.io 에 푸시하고, 운영 디렉터리에서 pull+재기동한다.
# Usage: ./scripts/deploy.sh [api|ai-agent|web|admin|worker|mcp|all]
# all = api + ai-agent + web + admin + worker + mcp (6개 앱 전부, DB 는 표준 postgres:16 이라 빌드 대상 아님)
# mcp 이미지 태그도 다른 앱과 동일하게 짧은 이름(mcp)으로 통일 — Dockerfile 경로만 apps/workplace-mcp.
#
# 환경변수:
#   BUILD_ONLY=1 — 빌드+푸시만 수행하고 배포(pull+재기동)·검증 단계는 건너뛴다.
#                  (ghcr 이미지만 갱신하고 운영 컨테이너는 그대로 둘 때)

REGISTRY="ghcr.io/bluleo78/smart-workplace"
PROD_DIR="$HOME/prod/smart-workplace"
PLATFORM="linux/amd64,linux/arm64"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

ensure_builder() {
  if ! docker buildx inspect multiplatform &>/dev/null; then
    log "Creating multiplatform builder"
    docker buildx create --name multiplatform --use
  else
    docker buildx use multiplatform
  fi
}

# 빌드 context/Dockerfile 매핑.
# api: context = apps/workplace-api/ (Dockerfile 이 상대경로 COPY 사용)
# ai-agent/web/admin: context = . (프로젝트 루트, Dockerfile 이 apps/ 절대경로 COPY + 워크스페이스 lockfile 필요)
build_and_push() {
  local app=$1
  case $app in
    api)
      log "Building + pushing $app (context: apps/workplace-api/)"
      docker buildx build --platform "$PLATFORM" -t "$REGISTRY/api:latest" --push apps/workplace-api/
      ;;
    ai-agent)
      log "Building + pushing $app (context: project root)"
      docker buildx build --platform "$PLATFORM" -t "$REGISTRY/ai-agent:latest" -f apps/workplace-ai-agent/Dockerfile --push .
      ;;
    web)
      log "Building + pushing $app (context: project root)"
      # VITE_MCP_URL 미설정 시 mcp 서비스 호스트 공개 포트(10002) 기본값으로 폴백(무해).
      docker buildx build --platform "$PLATFORM" -t "$REGISTRY/web:latest" -f apps/workplace-web/Dockerfile \
        --build-arg VITE_MCP_URL="${VITE_MCP_URL:-http://localhost:10002}" --push .
      ;;
    admin)
      log "Building + pushing $app (context: project root)"
      docker buildx build --platform "$PLATFORM" -t "$REGISTRY/admin:latest" -f apps/workplace-admin/Dockerfile --push .
      ;;
    worker)
      # worker: context = apps/workplace-worker/ (Python, 자기 디렉터리만 COPY — api 와 동일 패턴)
      log "Building + pushing $app (context: apps/workplace-worker/)"
      docker buildx build --platform "$PLATFORM" -t "$REGISTRY/worker:latest" --push apps/workplace-worker/
      ;;
    mcp)
      log "Building + pushing $app (context: project root)"
      docker buildx build --platform "$PLATFORM" -t "$REGISTRY/mcp:latest" -f apps/workplace-mcp/Dockerfile --push .
      ;;
    *)
      error "Unknown app: $app (valid: api, ai-agent, web, admin, worker, mcp)"
      ;;
  esac
}

deploy_app() {
  local app=$1
  log "Deploying $app to production"
  cd "$PROD_DIR"
  docker compose pull "$app"
  docker compose up -d --force-recreate "$app"
  cd - > /dev/null
}

verify_app() {
  local app=$1
  log "Verifying $app container..."
  sleep 10
  local status
  status=$(cd "$PROD_DIR" && docker compose ps "$app" --format '{{.Status}}' 2>/dev/null)
  if echo "$status" | grep -qi "up\|running"; then
    log "$app is running: $status"
  else
    error "$app failed to start: $status"
  fi
}

# --- Main ---

TARGET=${1:-all}

# Docker 로그인 확인 (config.json 직접 확인 — `docker info` hang 회피)
if ! grep -q "ghcr.io" "$HOME/.docker/config.json" 2>/dev/null; then
  warn "ghcr.io 로그인이 필요할 수 있습니다 (docker login ghcr.io, PAT write:packages)"
fi

if [ "$TARGET" = "all" ]; then
  APPS=("api" "ai-agent" "web" "admin" "worker" "mcp")
else
  APPS=("$TARGET")
fi

# 1. Build + Push (multiplatform)
log "=== Build + Push Phase ==="
ensure_builder
for app in "${APPS[@]}"; do
  build_and_push "$app"
done

if [ -n "${BUILD_ONLY:-}" ]; then
  log "=== BUILD_ONLY=1 — 배포·검증 단계 건너뜀 (ghcr 이미지만 갱신) ==="
  log "=== Build + Push Complete ==="
  exit 0
fi

# 2. Deploy
log "=== Deploy Phase ==="
for app in "${APPS[@]}"; do
  deploy_app "$app"
done

# 3. Verify
log "=== Verify Phase ==="
for app in "${APPS[@]}"; do
  verify_app "$app"
done

log "=== Deployment Complete ==="
