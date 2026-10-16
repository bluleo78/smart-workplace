#!/bin/sh
# 로컬 converter 실행(pnpm dev) — 이미지 빌드 후 운영과 같은 제약(읽기 전용 루트 FS + /tmp tmpfs)으로 컨테이너를 띄운다.
#
# 루트 `pnpm dev`(turbo, persistent) 는 한 태스크가 실패하면 전부 멈추므로:
#  - Docker 데몬이 없으면 안내 한 줄만 찍고 실패 대신 대기 상태로 남는다(다른 앱 dev 를 살린다).
#  - 이전 실행이 강제 종료돼 남은 같은 이름 컨테이너(--rm 이 못 지운 것)를 먼저 지워 이름·6085 포트 충돌을 막는다.

# 워커와 같은 규칙: 루트 .env 를 읽고, 토큰이 없으면 WORKPLACE_AI_AGENT_TOKEN → changeme-local
set -a
[ -f ../../.env ] && . ../../.env
set +a
export INTERNAL_SERVICE_TOKEN="${INTERNAL_SERVICE_TOKEN:-${WORKPLACE_AI_AGENT_TOKEN:-changeme-local}}"

NAME=smart-workplace-converter-dev

if ! docker info >/dev/null 2>&1; then
  echo "[converter] Docker 데몬에 연결할 수 없어 converter 를 띄우지 않습니다(다른 앱 dev 는 계속). Docker 를 켠 뒤 다시 실행하세요."
  # turbo 가 실패로 보지 않게 종료하지 않고 대기한다(종료 신호에는 바로 끝난다)
  exec tail -f /dev/null
fi

docker rm -f "$NAME" >/dev/null 2>&1
docker build -t workplace-converter-local . || exit 1
# 루프백에만 바인딩 — 내부 토큰 서비스를 LAN 에 노출하지 않는다. --init: Ctrl-C/종료 신호를 컨테이너 안 uvicorn 까지 전달. --rm: 정상 종료 시 컨테이너 자동 삭제
exec docker run --rm --init --name "$NAME" -p 127.0.0.1:6085:7085 -e INTERNAL_SERVICE_TOKEN \
  --read-only --tmpfs /tmp workplace-converter-local
