#!/usr/bin/env node
// gw-codex-loop 의 본체(WP-1295) — Codex 로 work-loop 를 반복한다. 칸(agent-project start, 실행기 codex)이 이 구동기를 띄운다.
//   node driver.mjs <work-loop 인자…>   예: node driver.mjs WP --queue "AI 개발팀"
// 하는 일(genia 확장과 같은 규칙 — 반복 상태 기계는 genia/loop.js 의 LoopDriver 를 함께 쓴다):
//   - 부르기: 쉬고 있을 때만 `codex exec`(처음)·`codex exec resume <대화>`(그 뒤)로 work-loop 스킬을 한 번 부른다. 마지막 답의
//     GW-NEXT-CHECK 로 다음 확인을 잡는다. none 이면 checkStop 으로 신원·상태(gw-status)를 확인해 멈출 까닭(신원 아님·DRAIN·RESTART)일 때만
//     멈추고, 그 밖(RUN·확인 실패)이면 잘못 쓴 none 으로 보고 20분 뒤 다시 본다(WP-1425).
//   - 깨우기: 알림 감시(agent-events tail·gw-events)를 자식으로 띄워 wake 줄마다 부른다 — 부르는 중이면 끝난 뒤 한 번.
//   - 신원·키: 이 칸 신원(GENIA_WORKS_AS)의 AI 키를 gw-lib 로 읽어 codex 프로세스의 환경 변수로만 넘긴다(명령줄·셸 도구에는 없다).
//     키 저장소·헤더 스크립트에 닿는 도구 호출은 PreToolUse hook(guard.mjs)이 막는다.
// 환경: GENIA_WORKS_MCP_URL(없으면 운영), GENIA_WORKS_TENANT, GENIA_WORKS_AGENT_DIR(start-agent 칸), GW_CODEX(테스트용 codex 경로).
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { LoopDriver, checkStop, noneDecisionMessage, projectKeyOf, shellQuote, watchEvents } from '../genia/loop.js'
import { TOKEN_ENV, codexArgs, threadIdFrom, workLoopPrompt } from './lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = join(root, 'scripts')
const DEFAULT_URL = 'https://genia-works.iacloud.kr/mcp'
const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version
  } catch {
    return '0'
  }
})()

const args = process.argv.slice(2).join(' ').trim()
const projectKey = projectKeyOf(args)
if (!projectKey) {
  process.stderr.write('사용: gw-codex-loop <프로젝트 키> [--queue "<라벨>"]\n')
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

const work = mkdtempSync(join(tmpdir(), 'gw-codex-'))
const outFile = join(work, 'last.txt')
let thread
let child
let events
let exiting = false

function invoke(loopArgs) {
  const key = readKey()
  if (!key) log('AI 키를 찾지 못했습니다 — GENIA_WORKS_AS 와 등록된 키를 확인하세요(work-loop 이 신원 확인에서 멈춥니다)')
  rmSync(outFile, { force: true })
  const argv = codexArgs({
    thread,
    outFile,
    mcpUrl: process.env.GENIA_WORKS_MCP_URL || DEFAULT_URL,
    tenant: process.env.GENIA_WORKS_TENANT,
    guardCommand: 'node ' + shellQuote(join(root, 'codex', 'guard.mjs')),
    prompt: workLoopPrompt({ skillsDir: join(root, 'skills'), args: loopArgs }),
    version: pluginVersion,
  })
  const env = { ...process.env, [TOKEN_ENV]: key, GENIA_WORKS_RUNNER_WAKES: '1' }
  delete env.GENIA_WORKS_TOKEN
  log(thread ? `work-loop 부름(대화 ${thread} 이어서)` : 'work-loop 부름(새 대화)')
  // --json 출력은 줄 단위로 읽어 thread.started 의 대화 id 만 찾는다 — 한 번의 실행이 길어도 출력을 메모리에 쌓지 않는다.
  // 찾은 뒤에도 끝까지 읽어 버린다(읽기를 멈추면 파이프가 차서 codex 가 멈춘다).
  let id
  child = spawn(process.env.GW_CODEX || 'codex', argv, { env, stdio: ['ignore', 'pipe', 'inherit'] })
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!id) id = threadIdFrom(line)
  })
  child.on('error', (e) => log('codex 를 띄우지 못했습니다: ' + e.message))
  child.on('close', (code) => {
    child = undefined
    if (id) thread = id
    let text = ''
    try {
      text = readFileSync(outFile, 'utf8')
    } catch {
      // 마지막 답이 없으면(실패) 기본 간격으로 다시 본다.
    }
    if (code !== 0) {
      log(`codex 가 ${code} 로 끝났습니다`)
      // 이어 받기에 실패하면 다음엔 새 대화로 — 지워진 대화를 계속 붙잡지 않게.
      if (thread && !id) thread = undefined
    }
    if (text) process.stdout.write(text.trimEnd() + '\n')
    if (exiting) return
    const r = driver.settled(text)
    if (r.action === 'timer') log(`다음 확인 ${Math.round(r.delayMs / 1000)}초 뒤`)
    else if (r.action === 'checking') log('GW-NEXT-CHECK none — 멈출지 상태를 확인합니다')
    // none 확인 결과는 onDecision 이 한 줄로 남긴다.
  })
}

const driver = new LoopDriver({
  run: invoke,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h),
  // none 확인(WP-1425) — 신원은 readKey 처럼 GENIA_WORKS_AS 로 본다(까닭은 loop.js checkStop 설명).
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
  rmSync(work, { recursive: true, force: true })
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
