// 바깥 구동기(gw-codex-loop·gw-opencode-loop)의 공용 뼈대(WP-1410) — 두 구동기는 「한 회차를 어떻게 부르는가」(setup 이 돌려주는 run)만 다르고 나머지는 같다:
//   - 인자 검사(프로젝트 키가 없으면 사용법을 알리고 2 로 끝남)·플러그인 버전·로그 형식,
//   - 이 칸 신원의 AI 키 읽기(gw-lib 의 gw_identity_key — 값은 메모리에만 두고 출력하지 않는다),
//   - 반복 상태 기계(loop.js 의 LoopDriver)·none 확인(checkStop)·알림 감시(watchEvents)·종료 신호 처리.
// genia 확장(index.ts → loop.js)은 이 파일을 읽지 않는다 — 자식 프로세스를 띄우는 바깥 구동기 전용이라 loop.js 와 나눠 둔다.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LoopDriver, checkStop, noneDecisionMessage, projectKeyOf, watchEvents, workLoopPrompt } from './loop.js'

const DEFAULT_URL = 'https://genia-works.iacloud.kr/mcp'

/**
 * 바깥 구동기를 띄운다 — process.argv 의 work-loop 인자로 반복을 시작하고 종료 신호까지 돈다.
 *   name:    로그에 쓰는 프로그램 이름(「<name> 를 띄우지 못했습니다」·「<name> 가 <code> 로 끝났습니다」) — codex·opencode.
 *   command: 사용법 안내에 쓰는 칸 명령 이름(gw-codex-loop 등).
 *   setup(ctx): 인자 검사를 통과한 뒤 한 번 불린다. { run, shutdown? } 를 돌려준다.
 *     ctx: { root(플러그인 폴더), log, version(플러그인 버전), mcpUrl, tenant, prompt(loopArgs) → work-loop 프롬프트,
 *            env(extra) → 프로그램에 넘길 환경(지금 환경 + extra(MCP 토큰 등) + 「깨우기는 실행기가」 표시, 사람의 내 토큰은 지운다) }
 *     run(loopArgs, key): 한 회차를 띄우고 { child, finish(code) → 마지막 답 } 을 돌려준다. 진행 요약 로그·대화 이어 받기는 run 이 맡는다.
 *     shutdown(): 종료 때 정리(임시 폴더 등).
 */
export function runExternalDriver({ name, command, setup }) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const scripts = join(root, 'scripts')
  const version = (() => {
    try {
      return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version
    } catch {
      return '0'
    }
  })()

  const args = process.argv.slice(2).join(' ').trim()
  const projectKey = projectKeyOf(args)
  if (!projectKey) {
    process.stderr.write(`사용: ${command} <프로젝트 키> [--queue "<라벨>"]\n`)
    process.exit(2)
  }

  const log = (msg) => process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`)

  // 이 칸 신원의 AI 키 — 스크립트와 같은 규칙(gw_identity_key: 세션 선택 > GENIA_WORKS_AS). 값은 메모리에만 두고 출력하지 않는다.
  function readKey() {
    try {
      return execFileSync('sh', ['-c', '. "$1/gw-lib.sh" && gw_identity_key', 'sh', scripts], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return ''
    }
  }

  const { run, shutdown: cleanup } = setup({
    root,
    log,
    version,
    mcpUrl: process.env.GENIA_WORKS_MCP_URL || DEFAULT_URL,
    tenant: process.env.GENIA_WORKS_TENANT,
    prompt: (loopArgs) => workLoopPrompt({ skillsDir: join(root, 'skills'), args: loopArgs }),
    env: (extra) => {
      const env = { ...process.env, ...extra, GENIA_WORKS_WAKE_MODE: 'runner', GENIA_WORKS_RUNNER_WAKES: '1' }
      delete env.GENIA_WORKS_TOKEN
      return env
    },
  })

  let child
  let events
  let exiting = false

  function invoke(loopArgs) {
    const key = readKey()
    if (!key) log('AI 키를 찾지 못했습니다 — GENIA_WORKS_AS 와 등록된 키를 확인하세요(work-loop 이 신원 확인에서 멈춥니다)')
    const r = run(loopArgs, key)
    child = r.child
    child.on('error', (e) => log(`${name} 를 띄우지 못했습니다: ` + e.message))
    child.on('close', (code, signal) => {
      child = undefined
      const text = r.finish(code)
      // 신호로 끝나면 code 는 null 이다 — OOM(SIGKILL)·바깥 종료가 보이게 신호 이름을 남긴다.
      if (signal) log(`${name} 가 신호 ${signal} 로 끝났습니다`)
      else if (code !== 0) log(`${name} 가 ${code} 로 끝났습니다`)
      if (text) process.stdout.write(text.trimEnd() + '\n')
      if (exiting) return
      const s = driver.settled(text)
      if (s.action === 'timer') log(`다음 확인 ${Math.round(s.delayMs / 1000)}초 뒤`)
      else if (s.action === 'checking') log('GW-NEXT-CHECK none — 멈출지 상태를 확인합니다')
      // none 확인 결과는 onDecision 이 한 줄로 남긴다.
    })
  }

  const driver = new LoopDriver({
    run: invoke,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    // none 확인(WP-1425) — 신원은 readKey 처럼 GENIA_WORKS_AS 로 본다(프로그램은 구동기의 자식이라 조상 찾기로는 이 칸을 못 찾는다 —
    // loop.js checkStop 설명).
    checkStop: ({ nextCheckAt }) => checkStop({ scriptsDir: scripts, nextCheckAt, identity: 'env' }),
    onDecision: (d) => {
      if (!exiting) log(noneDecisionMessage(d))
    },
  })

  function shutdown() {
    exiting = true
    driver.stop()
    // 알림 감시의 재시작을 막고 감시 그룹째 끝낸다.
    events?.stop()
    child?.kill('SIGTERM')
    cleanup?.()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGHUP', shutdown)

  // 알림 감시 — wake 줄은 기록하고 깨우며, fatal 줄(신원·인증 실패)은 기록만 하고 주기 확인으로 돈다. 그 밖에 끝나면 감시가 스스로 다시 뜬다.
  events = watchEvents({
    scriptsDir: scripts,
    agentDir: process.env.GENIA_WORKS_AGENT_DIR,
    projectKey,
    onWake: (line) => {
      log(line)
      driver.wake()
    },
    onFatal: log,
  })
  driver.start(args)
}
