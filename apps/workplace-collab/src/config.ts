import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config()

/**
 * 동기화 서버 설정 — 포트·API 주소·서비스 간 토큰·저장 디바운스.
 * testMode 는 E2E 전용: 문서 이름 네임스페이스 접두(`{ns}/wiki-page:{id}`)를 허용한다
 * (메모리 저장·인증 스텁·/__test 경로도 이 플래그로만 켠다 — app.ts). 운영에서는 항상 false.
 */
export interface CollabConfig {
  port: number
  apiUrl: string
  internalToken: string
  testMode: boolean
  /** 마지막 변경 후 저장까지 기다리는 시간(ms) — 타이핑 중 매 글자 저장 방지. */
  debounceMs: number
  /** 계속 편집 중이어도 이 시간(ms) 안에는 반드시 저장. */
  maxDebounceMs: number
  /** 저장 실패 후 첫 재시도 간격(ms) — 실패마다 2배, storeRetryMaxMs 상한. 기본 1000. */
  storeRetryBaseMs?: number
  /** 저장 재시도 간격 상한(ms). 기본 30000. */
  storeRetryMaxMs?: number
  /** 종료 시 미저장 문서의 최종 저장을 기다리는 최대 시간(ms) — K8S 종료 유예(기본 30초) 안에 끝나게. 기본 20000. */
  shutdownTimeoutMs?: number
  /** AI 적용 위치 ✦ 표식을 보이는 시간(ms). 기본 COLLAB_AI_MARKER_MS(3000). 테스트가 줄인다. */
  aiMarkerMs?: number
  /** apply-markdown 한 요청의 전체 기한(ms) — 기본 APPLY_DEADLINE_MS(server.ts). 테스트가 줄인다. */
  applyDeadlineMs?: number
}

/**
 * 로컬 개발 기본 내부 토큰 — API local 프로필(application-local.yml)의 collab·worker 기본값과 같은 값.
 * `pnpm dev`(COLLAB_DEV_DEFAULTS=1)에서만 쓴다. 운영은 토큰이 없으면 부트를 거부한다(index.ts).
 */
export const DEV_INTERNAL_TOKEN = 'changeme-local'

/** 환경 변수 → 설정. 내부 토큰은 API 와 같은 단일 서비스 간 토큰을 공유한다(application.yml 과 같은 폴백). */
export function loadConfig(): CollabConfig {
  // .env·.env.local(dotenv)이 먼저 적용되므로 개발자가 지정한 토큰이 개발 기본값보다 우선한다.
  const devDefault = process.env.COLLAB_DEV_DEFAULTS === '1' ? DEV_INTERNAL_TOKEN : ''
  return {
    port: Number(process.env.PORT ?? 6095),
    apiUrl: process.env.WORKPLACE_API_URL ?? 'http://localhost:6060',
    internalToken: (process.env.INTERNAL_SERVICE_TOKEN ?? process.env.WORKPLACE_AI_AGENT_TOKEN ?? '') || devDefault,
    testMode: process.env.COLLAB_TEST_MODE === '1',
    debounceMs: 2000,
    maxDebounceMs: 10000,
  }
}
