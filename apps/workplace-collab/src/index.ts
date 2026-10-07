// DOM 전역 설치가 다른 모든 import(TipTap 변환기)보다 먼저여야 한다.
import './dom-install'

import { buildCollabServer } from './app'
import { loadConfig } from './config'

// 노트 동기화 서버 진입점 — WebSocket /collab + 내부 HTTP(/internal/*) 를 한 포트에서 받는다.
// COLLAB_TEST_MODE=1 이면 E2E 테스트 모드(메모리 저장·인증 스텁·/__test/*) — 운영에서 절대 켜지 않는다.
const cfg = loadConfig()
if (!cfg.internalToken && !cfg.testMode) {
  // 내부 토큰 없이는 API 문서 저장소 호출이 전부 401 — 편집이 저장되지 않는 상태로 뜨지 않게 막는다.
  console.error('[collab] INTERNAL_SERVICE_TOKEN 미설정 — 부트 중단')
  process.exit(1)
}
const app = buildCollabServer(cfg)
await app.listen()
console.log(`[collab] listening on ${app.address.port}${cfg.testMode ? ' (test mode)' : ''}`)

// 종료 신호 — 남은 저장을 마치고(문서 언로드) 내려간다. 두 번째 신호는 destroy 가 같은 Promise 를 공유한다.
const shutdown = async () => {
  await app.destroy()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
