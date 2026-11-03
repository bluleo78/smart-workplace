// genia-works 의 Gen:iA Code(genia) 확장이 쓰는 순수 함수·상태 기계 — genia API 를 쓰지 않아 node --test 로 따로 검증한다(WP-1294).
// 알림 감시(watchEvents)만 자식 프로세스를 띄우는데, spawn·kill·타이머를 주입받아 테스트는 가짜로 돈다.
// genia 쪽 연결(이벤트·명령·MCP 등록)은 index.ts 에 두고, 판단은 모두 여기서 한다. Claude Code 의 mod(hooks/register.js)와 lib.js 의 나눔과 같다.
// 알림 감시(watchEvents)는 자식 프로세스를 띄운다 — spawn·kill·타이머는 주입할 수 있게 두어 테스트가 가짜로 돌린다.
import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { isKeyPath, isHeaderScriptCall, toolTargets, containsSecretKey, HEADER_SCRIPT_DENY, KEY_PATH_DENY } from '../hooks/lib.js'

// 다음 확인 간격의 범위·기본값 — work-loop 5번(60초~1시간)과 같다. 줄이 없으면(사람이 끼어들어 끝남 등) 20분 뒤 다시 본다.
export const MIN_DELAY_MS = 60 * 1000
export const MAX_DELAY_MS = 60 * 60 * 1000
export const DEFAULT_DELAY_MS = 20 * 60 * 1000

// genia 에서 보이는 명령 이름 — Claude 플러그인의 /genia-works:login·as·logout 과 같은 일을 한다. genia 확장 명령은 이 이름으로 부른다.
export const GENIA_COMMANDS = { loop: 'gw-loop', login: 'gw-login', as: 'gw-as', logout: 'gw-logout' }

// genia 에서 키 저장소·헤더 스크립트를 막을 때의 문구 — Claude 문구(lib.js 한 곳)의 /genia-works:as 를 genia 명령으로 바꿔 보인다.
export const GENIA_KEY_PATH_DENY = KEY_PATH_DENY.replace(/\/genia-works:as\b/, '/' + GENIA_COMMANDS.as)
export const GENIA_HEADER_SCRIPT_DENY = HEADER_SCRIPT_DENY.replace(/\/genia-works:as\b/, '/' + GENIA_COMMANDS.as)

/**
 * work-loop 의 마지막 줄 「GW-NEXT-CHECK <ISO 시각>|none」 을 읽는다(SKILL.md 「깨우기를 실행기가 맡는 세션」).
 * 돌려주는 값: { kind: 'none' } — 다음 확인을 잡지 않는다(신원 오류·DRAIN·RESTART),
 *   { kind: 'at', delayMs } — 그 시각까지(60초~1시간으로 자름), { kind: 'missing', delayMs } — 줄이 없거나 시각을 못 읽음(기본 20분).
 * 여러 번 나오면 마지막 것을 쓴다(앞의 것은 중간 설명일 수 있다).
 */
export function parseNextCheck(text, nowMs) {
  const lines = typeof text === 'string' ? text.split(/\r?\n/) : []
  let last
  for (const l of lines) {
    const m = /^\s*`?GW-NEXT-CHECK\s+(\S+?)`?\s*$/.exec(l)
    if (m) last = m[1]
  }
  if (last === undefined) return { kind: 'missing', delayMs: DEFAULT_DELAY_MS }
  if (last.toLowerCase() === 'none') return { kind: 'none' }
  const at = Date.parse(last)
  if (Number.isNaN(at)) return { kind: 'missing', delayMs: DEFAULT_DELAY_MS }
  return { kind: 'at', delayMs: clampDelay(at - nowMs) }
}

/** 다음 확인 간격을 60초~1시간으로 자른다. */
export function clampDelay(ms) {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, ms))
}

/**
 * work-loop 반복 상태 기계 — 「한 번에 하나만 부른다」·「일하는 중 깨움은 모았다가 끝나면 한 번」·「끝나면 다음 확인을 잡는다」를 맡는다.
 * genia 연결은 주입한다: run(args) — 지금 부르기를 시작한다(쉬는 세션에 /skill:work-loop 넣기), setTimer(fn, ms)·clearTimer(h), now().
 *
 * 흐름: start(args) → 바로 한 번 부름 → settled(text) 에서 다음 확인 시각을 정해 타이머를 건다. 부르는 중에 온 wake() 는 표시만 해 두고,
 * settled 때 표시가 있으면 타이머 대신 바로 다시 부른다(work-loop 4번: 처리 중인 이슈는 끊지 않는다). 쉬는 중 wake() 는 바로 부른다.
 * 사람이 직접 입력해 생긴 실행은 busy() 로 알린다 — 그 사이 타이머·wake 는 settled 까지 기다린다.
 */
export class LoopDriver {
  constructor({ run, setTimer, clearTimer, now = () => Date.now() }) {
    this.deps = { run, setTimer, clearTimer, now }
    this.args = undefined // 반복 중인 work-loop 인자(없으면 반복하지 않음)
    this.running = false // genia 가 지금 일하는 중(우리가 부른 것이든 사람이 넣은 것이든)
    this.pendingWake = false
    this.timer = undefined
  }

  /** 반복 시작 — 인자를 기억하고 바로 한 번 부른다. 이미 일하는 중이면 끝난 뒤 부른다. */
  start(args) {
    this.args = args
    this.#clear()
    if (this.running) this.pendingWake = true
    else this.#invoke()
  }

  /** 반복 그만 — 인자를 비우고 타이머를 지운다(돌고 있는 부르기는 그대로 끝난다). GW-NEXT-CHECK none 도 이것으로 멈춘다. */
  stop() {
    this.args = undefined
    this.pendingWake = false
    this.#clear()
  }

  /** 알림(wake 줄) — 쉬는 중이면 바로 부르고, 일하는 중이면 끝난 뒤 한 번 부른다. 반복 중이 아니면(none 으로 멈춤 포함) 무시한다. */
  wake() {
    if (!this.args) return
    if (this.running) {
      this.pendingWake = true
      return
    }
    this.#clear()
    this.#invoke()
  }

  /** genia 가 일을 시작했다(사람이 넣은 입력 포함) — 그 사이 타이머는 미룬다. */
  busy() {
    this.running = true
  }

  /**
   * genia 가 일을 마쳤다 — 마지막 답(text)에서 다음 확인을 읽어 잡는다. 반환: 이번에 정한 것(테스트·상태 줄용).
   * 'wake' — 모아 둔 깨움으로 바로 다시 부름, 'none' — 멈춤, 'timer' — delayMs 뒤 부름, 'idle' — 반복 중이 아니거나 이미 멈춤.
   */
  settled(text) {
    this.running = false
    // 반복 중이 아니면 아무것도 잡지 않는다. GW-NEXT-CHECK none 으로 멈춘 뒤(stop 으로 인자를 비웠다) 사람이 칸에 넣은 입력이 끝나도
    // (그 답엔 줄이 없어 'missing') 여기서 걸려 다시 돌지 않는다 — /gw-loop 를 다시 불러야 재개.
    if (!this.args) return { action: 'idle' }
    const next = parseNextCheck(text, this.deps.now())
    if (next.kind === 'none') {
      this.stop()
      return { action: 'none' }
    }
    if (this.pendingWake) {
      this.pendingWake = false
      this.#invoke()
      return { action: 'wake' }
    }
    this.#clear()
    this.timer = this.deps.setTimer(() => {
      this.timer = undefined
      // 타이머가 걸린 뒤 반복을 그만뒀으면(none 포함) 부르지 않는다(지우지 못한 타이머가 남았을 때 대비).
      if (!this.args) return
      if (this.running) this.pendingWake = true
      else this.#invoke()
    }, next.delayMs)
    return { action: 'timer', delayMs: next.delayMs }
  }

  #invoke() {
    this.running = true
    this.deps.run(this.args)
  }

  #clear() {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer)
    this.timer = undefined
  }
}

/**
 * 알림 감시 출력 한 줄의 뜻 — 'wake'(깨움) · 'fatal'(「gw-events: …」 — AI 키 신원 아님·인증 실패, 다시 띄우지 않는다) · 'ignore'.
 * agent-events tail(start-agent 칸)과 gw-events(직접 띄운 세션)가 같은 줄 형식을 낸다.
 */
export function classifyEventLine(line) {
  if (/^wake\s/.test(line)) return 'wake'
  if (/^gw-events:/.test(line)) return 'fatal'
  return 'ignore'
}

/**
 * 알림 감시로 띄울 명령 — start-agent 칸(GENIA_WORKS_AGENT_DIR 가 있음)은 감시 창의 기록을 따라가는 agent-events tail,
 * 사람이 직접 띄운 세션은 gw-events. work-loop SKILL.md 「알림으로 깨우기 — 걸기」와 같은 규칙이다.
 */
export function eventsCommand({ scriptsDir, agentDir, projectKey }) {
  return agentDir
    ? [scriptsDir + '/agent-events', 'tail', agentDir, projectKey]
    : [scriptsDir + '/gw-events', projectKey]
}

// 알림 감시가 끝났을 때 다시 띄우기까지 — 감시 창이 늘 붙잡고 있으므로 짧게, 그러나 같은 실패를 쉬지 않고 되풀이하지 않게.
export const EVENTS_RESTART_MS = 30 * 1000

/**
 * 알림 감시 생애 주기 — eventsCommand 로 고른 명령을 자기 프로세스 그룹(detached)으로 띄워 출력 줄을 classifyEventLine 으로 나눈다.
 * wake 줄은 onWake(line), fatal 줄은 onFatal(line) 뒤 다시 띄우지 않는다(work-loop 5번: 주기 확인만). 그 밖의 이유로 끝나면
 * restartMs 뒤 다시 띄운다(shouldRestart() 가 거짓이면 띄우지 않음). stop() 은 재시작을 막고 감시 그룹째(감시가 부른 curl 등까지) 끝낸다.
 * genia 확장(index.ts)과 Codex 구동기(codex/driver.mjs)가 함께 쓴다. spawn·kill·타이머는 테스트용 주입 자리다.
 * 돌려주는 값: { stop(), running } — running 은 지금 감시 프로세스가 떠 있는지(재시작 대기 중·fatal·stop 뒤면 false).
 */
export function watchEvents({
  scriptsDir,
  agentDir,
  projectKey,
  onWake,
  onFatal,
  shouldRestart = () => true,
  restartMs = EVENTS_RESTART_MS,
  spawn = nodeSpawn,
  kill = (pid, signal) => process.kill(pid, signal),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const [cmd, ...args] = eventsCommand({ scriptsDir, agentDir, projectKey })
  let child
  let timer
  let fatal = false
  let stopped = false

  function launch() {
    timer = undefined
    if (child || fatal || stopped) return
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
    child = c
    createInterface({ input: c.stdout }).on('line', (line) => {
      const kind = classifyEventLine(line)
      if (kind === 'wake') onWake?.(line)
      else if (kind === 'fatal') {
        // AI 키 신원이 아님·인증 실패 — 다시 띄우지 않는다.
        fatal = true
        onFatal?.(line)
      }
    })
    c.on('exit', () => {
      if (child === c) child = undefined
      if (!fatal && !stopped && shouldRestart()) timer = setTimer(launch, restartMs)
    })
  }

  launch()
  return {
    get running() {
      return Boolean(child)
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
      if (child?.pid) {
        try {
          kill(-child.pid, 'SIGTERM')
        } catch {
          // 이미 끝났다.
        }
      }
      child = undefined
    },
  }
}

/** /gw-loop 인자의 첫 단어(프로젝트 키) — 알림 감시가 그 프로젝트만 보게. 키 형식이 아니면 undefined. */
export function projectKeyOf(args) {
  const first = String(args ?? '').trim().split(/\s+/)[0]
  return /^[A-Za-z0-9_-]+$/.test(first) ? first : undefined
}

// 도구 입력에서 검사할 글 — Claude mod 와 같은 필드(경로·명령) + genia 의 codemode 스크립트(code·script).
const SCRIPT_FIELDS = ['code', 'script']

/**
 * 키를 지키는 도구 차단 판정(KEY_PATH_DENY·HEADER_SCRIPT_DENY 대응) — 막아야 하면 사람에게 보일 이유, 아니면 undefined.
 * bash 는 헤더 스크립트 실행도 막는다(그 출력이 활성 AI 키다). 우회(다른 이름으로 복사해 실행 등)는 막지 못한다 — README 에 적는다.
 */
export function toolBlockReason(toolName, input) {
  const texts = [...toolTargets(input)]
  if (input && typeof input === 'object') {
    for (const k of SCRIPT_FIELDS) if (typeof input[k] === 'string') texts.push(input[k])
  }
  if (texts.some(isKeyPath)) return GENIA_KEY_PATH_DENY
  if (isHeaderScriptCall(input)) return GENIA_HEADER_SCRIPT_DENY
  // codemode 스크립트 안에서 헤더 스크립트를 부르는 것도 막는다(셸 명령처럼 실행 자리를 보지 않고 이름이 보이면).
  if (toolName === 'codemode' && texts.some((t) => /gw-(?:headers|session-key)\b/.test(t))) return GENIA_HEADER_SCRIPT_DENY
  return undefined
}

/** 입력(프롬프트)에 키·토큰 모양이 있으면 true — 대화 기록에 남지 않게 버린다. */
export const promptHasSecret = containsSecretKey

// 프롬프트에서 키를 버릴 때의 문구 — 키 값은 담지 않는다.
export const GENIA_PROMPT_KEY_DROP = 'genia-works 키나 토큰은 대화에 넣을 수 없습니다 — AI 키는 /' + GENIA_COMMANDS.login + ' 으로 등록하세요'

/** 워크스페이스 헤더 — tenant 가 숫자일 때만 X-On-Behalf-Of-Tenant 를 붙인다(그 밖의 값은 헤더·TOML 에 끼워 넣지 않는다). genia·Codex 가 함께 쓴다. */
export function tenantHeader(tenant) {
  return tenant && /^[0-9]+$/.test(tenant) ? { 'X-On-Behalf-Of-Tenant': tenant } : {}
}

/**
 * MCP 서버 설정 — 이 세션 신원이 AI 면 헤더 스크립트(--authorization)가 연결할 때마다 키를 읽고, 내 토큰이면 확장이 시작 때 받아 둔 값을 쓴다.
 * 워크스페이스(Works 가 띄운 AI)는 값이 있을 때만 붙인다. User-Agent 를 genia 로 두어 서버 작업 기록의 도구 이름이 bun 으로 남지 않게 한다.
 */
export function mcpConfig({ url, scriptsDir, aiIdentity, myToken, tenant, version }) {
  const headers = {
    Authorization: aiIdentity ? '!' + shellQuote(scriptsDir + '/gw-headers') + ' --authorization' : 'Bearer ' + (myToken || 'invalid'),
    'User-Agent': 'genia/' + (version || '0'),
    ...tenantHeader(tenant),
  }
  return { url, headers, description: 'Gen:iA Works — 이슈·노트·드라이브·메일·채널·캘린더·연락처·알림' }
}

/**
 * genia 설정(mcp.json 내용)에 genia-works 서버가 따로 적혀 있는지 — 있으면 그 항목이 확장의 등록보다 먼저 쓰여 신원 전환·키 보호가 듣지 않는다.
 * genia 는 이름의 - 와 _ 를 같게 본다(mcp.md 「Configuration rules」).
 */
export function conflictingMcpEntry(mcpJsonText) {
  try {
    const servers = JSON.parse(mcpJsonText)?.mcpServers ?? {}
    return Object.keys(servers).find((n) => n.replace(/-/g, '_').toLowerCase() === 'genia_works')
  } catch {
    return undefined
  }
}

/** 셸 한 단어로 감싼다(경로의 공백·따옴표). */
export function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}
