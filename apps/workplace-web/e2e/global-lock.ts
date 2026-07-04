import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 병렬 Claude 세션 간 E2E 실행 직렬화.
// - CPU 코어 대비 workers 비율(playwright.config.ts)은 "세션 1개"를 전제로 튜닝돼 있어,
//   2~3개 세션이 동시에 pnpm test:e2e 를 돌리면 워커 수가 코어를 초과 구독해 지연 스파이크→
//   expect/actionTimeout 을 넘기는 flaky 를 유발한다(백엔드 SharedTestDbLock 과 동일 원인 클래스).
// - 워커 수를 낮추는 대신, 세션 단위로 뮤텍스를 걸어 "한 번에 한 세션만" 풀 workers 로 돌게 한다
//   (동시 세션은 대기 후 순차 실행 — 세션별 처리량은 그대로, 오버서브스크립션만 제거).
// - flock 이 macOS 기본 제공이 아니라 mkdir 원자성으로 구현(디렉토리 생성은 OS 레벨 exclusive).
const LOCK_DIR = join(tmpdir(), 'smart-workplace-e2e.lock')
const PID_FILE = join(LOCK_DIR, 'pid')
const POLL_MS = 3000
const LOG_EVERY_MS = 15000

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 이전 프로세스가 비정상 종료(kill -9 등)해 락 디렉토리만 남은 경우 정리.
function reclaimIfStale(): void {
  if (!existsSync(PID_FILE)) return
  const heldBy = Number(readFileSync(PID_FILE, 'utf-8').trim())
  if (Number.isFinite(heldBy) && !isProcessAlive(heldBy)) {
    rmSync(LOCK_DIR, { recursive: true, force: true })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default async function globalSetup(): Promise<() => void> {
  if (process.env.CI) {
    // CI 는 단일 러너 — 세션 간 경쟁이 없어 락 불필요.
    return () => {}
  }

  let lastLog = 0
  for (;;) {
    reclaimIfStale()
    try {
      mkdirSync(LOCK_DIR)
      writeFileSync(PID_FILE, String(process.pid))
      break
    } catch {
      const now = Date.now()
      if (now - lastLog > LOG_EVERY_MS) {
        console.log('[e2e] 다른 세션이 E2E 실행 중 — 대기합니다 (락: ' + LOCK_DIR + ')')
        lastLog = now
      }
      await sleep(POLL_MS)
    }
  }

  return () => {
    rmSync(LOCK_DIR, { recursive: true, force: true })
  }
}
