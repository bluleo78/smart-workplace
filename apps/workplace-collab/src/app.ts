import type { CollabConfig } from './config'
import { createCollabServer, type CollabServer } from './server'
import { createTestMode, TEST_MODE_INTERNAL_TOKEN } from './testMode'

/**
 * 설정으로 서버 조립 — 진입점(index.ts)과 테스트가 같은 경로를 쓴다.
 * COLLAB_TEST_MODE(cfg.testMode)만이 메모리 저장소·인증 스텁·/__test 경로를 켠다. 그 밖엔 API 저장소·API 판정.
 * 테스트 모드에서 내부 토큰이 비어 있으면 기본 테스트 토큰을 쓴다(E2E 가 apply-markdown 을 부를 수 있게).
 */
export function buildCollabServer(cfg: CollabConfig): CollabServer {
  if (!cfg.testMode) return createCollabServer(cfg)
  const tm = createTestMode()
  return createCollabServer(
    { ...cfg, internalToken: cfg.internalToken || TEST_MODE_INTERNAL_TOKEN },
    { store: tm.store, auth: tm.auth, testRoutes: tm.routes },
  )
}
