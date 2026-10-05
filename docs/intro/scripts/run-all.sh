#!/usr/bin/env bash
# 소개 자료를 빈 격리 스택에서 처음부터 다시 만든다: DB 초기화 → 시드 → AI 작업 → 촬영 → PDF.
#
#   JAR=<api jar> LOG=<api 로그> INTRO_AI_TOKEN=<에이전트 LLM 토큰> docs/intro/scripts/run-all.sh
#
# 전제(README 참조): 웹(6273, API_PORT=6160 로 바꾼 vite)과 ai-agent(6170)가 떠 있다.
# 토큰은 환경변수로만 넘긴다 — 파일·커밋에 남기지 않는다.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${INTRO_AI_TOKEN:?INTRO_AI_TOKEN 이 필요하다(지니의 LLM 토큰)}"
docs/intro/scripts/reset-stack.sh
node docs/intro/scripts/seed-demo.mjs >/dev/null
# 회사 이름 — 워크스페이스 이름 변경 API 가 없어 촬영용 DB 에서만 직접 바꾼다(레일 하단 아바타 글자).
docker exec intro-deck-db psql -U app -d workplace -qc "update tenant set name='누리커머스' where id=1"
node docs/intro/scripts/seed-ai.mjs
node docs/intro/scripts/capture-screens.mjs
node docs/intro/scripts/build-pdf.mjs
