// E2E 고아 webServer 정리(WP-972).
// Playwright 는 webServer(노트 동기화 테스트 서버·vite preview)를 자기 자식 프로세스 그룹의 우두머리로 띄우고, 끝날 때 그룹째 내린다.
// 러너가 SIGKILL 이나 timeout(SIGTERM → pnpm exec)으로 끊기면 그 정리가 돌지 않아 그룹이 부모 없이 남는다
// (10-26 정리 때 동기화 서버 15묶음+, 18시간 된 preview). 다음 E2E 가 전역 락을 잡은 뒤 이런 그룹을 찾아 내린다.
// 판정: 우리 webServer 명령으로 시작한 그룹 우두머리인데 부모가 Playwright 러너가 아니다(부모가 죽어 init·subreaper 로 넘어감).
// 다른 세션이 락을 기다리며 띄워 둔 서버는 부모가 살아 있는 러너라 건드리지 않는다.
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Playwright 는 webServer 명령을 셸로 띄우므로 우두머리 명령줄은 「/bin/sh -c <명령>」 그대로다. 명령줄 전체가 같아야 고른다 —
// 일부만 맞춰 보면 이 문자열을 인자로 담은 다른 프로세스(grep·셸 스크립트 등)까지 고르게 된다.
// dev 모드 서버는 E2E 전용 포트대(20000번대, playwright.config.ts E2E_PORT)만 — 사람이 띄운 6173 dev 서버는 건드리지 않는다.
const DIST = String.raw`\S*smart-workplace-e2e-dist-\d+`
const WEBSERVER_RE = [
  /^\/bin\/sh -c pnpm --filter @smart-workplace\/workplace-collab start:test$/,
  new RegExp(String.raw`^/bin/sh -c pnpm exec vite build --outDir ${DIST} --emptyOutDir --logLevel warn && pnpm exec vite preview --outDir ${DIST} --port 2\d{4} --strictPort$`),
  /^\/bin\/sh -c pnpm dev --port 2\d{4} --strictPort$/,
]
export const PREVIEW_DIR_PREFIX = 'smart-workplace-e2e-dist-'

/**
 * `ps -eo pid=,ppid=,pgid=,args=` 출력에서 고아 webServer 그룹의 pgid 를 고른다(순수 함수 — 테스트용).
 * @param {string} psOutput
 * @returns {number[]}
 */
export function findOrphanGroups(psOutput) {
  const procs = new Map()
  for (const line of psOutput.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), pgid: Number(m[3]), args: m[4] })
  }
  const orphans = []
  for (const [pid, p] of procs) {
    if (p.pgid !== pid || !WEBSERVER_RE.some((re) => re.test(p.args))) continue
    const parent = procs.get(p.ppid)
    if (!parent || !/playwright/.test(parent.args)) orphans.push(pid)
  }
  return orphans
}

/**
 * 살아 있는 프로세스가 쓰지 않는 preview 빌드 폴더(포트별)를 고른다 — 고아 preview 를 내린 뒤 남은 산출물.
 * 막 만들어져 아직 서버가 뜨기 전인 폴더를 지우지 않게 maxAgeMs 보다 오래된 것만.
 * @param {string[]} dirNames tmpdir 의 항목 이름
 * @param {string} psOutput
 * @param {(name: string) => number} ageMsOf
 * @param {number} maxAgeMs
 */
export function findStalePreviewDirs(dirNames, psOutput, ageMsOf, maxAgeMs) {
  return dirNames.filter(
    (name) => name.startsWith(PREVIEW_DIR_PREFIX) && !psOutput.includes(name) && ageMsOf(name) > maxAgeMs,
  )
}

/** 고아 webServer 그룹을 내리고 남은 preview 폴더를 지운다. 실패해도 E2E 를 막지 않는다. */
export function reapOrphanWebServers({ log = console.log } = {}) {
  if (process.platform === 'win32') return
  try {
    const ps = () => execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,args='], { encoding: 'utf8' })
    const groups = findOrphanGroups(ps())
    for (const pgid of groups) {
      try {
        process.kill(-pgid, 'SIGKILL')
      } catch {
        // 그 사이 끝났으면 무시
      }
    }
    if (groups.length) log(`[e2e] 이전 실행이 남긴 webServer ${groups.length}묶음을 정리했습니다 (pgid ${groups.join(', ')})`)
    const tmp = tmpdir()
    const stale = findStalePreviewDirs(readdirSync(tmp), ps(), (n) => Date.now() - statSync(join(tmp, n)).mtimeMs, 30 * 60_000)
    for (const name of stale) rmSync(join(tmp, name), { recursive: true, force: true })
  } catch (err) {
    log(`[e2e] 고아 webServer 정리 건너뜀: ${err instanceof Error ? err.message : String(err)}`)
  }
}
