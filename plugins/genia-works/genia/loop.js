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

// 바깥 구동기(OpenCode·Codex) 칸에서 막을 때의 문구(WP-1410) — 그 프로그램에는 신원 전환 명령(/gw-as·/genia-works:as)이 없고, 칸의 신원은
// 구동기가 정한다. 그래서 명령을 안내하지 않고 「직접 다루지 말라」만 알린다.
export const RUNNER_KEY_PATH_DENY = 'genia-works 키 저장소(~/.genia-works)는 열 수 없습니다. 이 칸의 신원과 키는 구동기가 정하니 직접 다루지 마세요.'
export const RUNNER_HEADER_SCRIPT_DENY = 'genia-works 헤더 스크립트는 직접 실행할 수 없습니다 — 이 칸의 신원과 키는 구동기가 정하니 직접 다루지 마세요.'

/**
 * work-loop 의 마지막 줄 「GW-NEXT-CHECK <ISO 시각>|none」 을 읽는다(SKILL.md 「깨우기를 실행기가 맡는 세션」).
 * 돌려주는 값: { kind: 'none' } — 다음 확인을 잡지 않는다(신원 오류·DRAIN·RESTART — LoopDriver 가 checkStop 으로 한 번 더 확인한다),
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

// GW-NEXT-CHECK none 을 받았을 때 멈출지 확인하는 시간 제한(WP-1425) — 신원 확인·상태 보고(gw-status, curl 최대 10초)를 합쳐 이 안에 끝내야 한다.
// 넘기면(네트워크가 매달림 등) 명령을 그룹째 끝내고 멈추지 않는 쪽(잘못 쓴 none)으로 본다 — 구동기가 확인을 기다리다 영영 서지 않게.
export const CHECK_STOP_TIMEOUT_MS = 15 * 1000

/**
 * none 을 받았는데 계속 돌기로 한 것이 연달아 n 번째일 때의 다음 확인 간격 — 기본 20분에서 번마다 두 배(20→40→60분, 1시간으로 자름).
 * 키가 회수돼도 gw-status 는 401·네트워크 실패를 RUN 으로 내므로, 같은 잘못이 되풀이될 때 20분마다 헛돌지 않게 늘린다.
 */
export function noneBackoffDelay(streak) {
  return Math.min(MAX_DELAY_MS, DEFAULT_DELAY_MS * 2 ** Math.max(0, streak))
}

/**
 * work-loop 반복 상태 기계 — 「한 번에 하나만 부른다」·「일하는 중 깨움은 모았다가 끝나면 한 번」·「끝나면 다음 확인을 잡는다」를 맡는다.
 * genia 연결은 주입한다: run(args) — 지금 부르기를 시작한다(쉬는 세션에 /skill:work-loop 넣기), setTimer(fn, ms)·clearTimer(h), now().
 * 선택(WP-1425): checkStop({ nextCheckAt }) — GW-NEXT-CHECK none 을 받았을 때 정말 멈출지 묻는다(Promise<{ stop, reason }>,
 *   보통 아래 checkStop 함수 — 늘 시간 안에 답한다고 믿는다). 계속 돌면 잡을 시각을 넘겨 상태 보고가 서버의 다음 확인 시각을 지우지 않게 한다.
 *   onDecision(decision) — 그 확인 결과(noneDecisionMessage 로 한 줄로 보인다). checkStop 이 없으면 none 은 예전처럼 바로 멈춘다.
 *
 * 흐름: start(args) → 바로 한 번 부름 → settled(text) 에서 다음 확인 시각을 정해 타이머를 건다. 부르는 중에 온 wake() 는 표시만 해 두고,
 * settled 때 표시가 있으면 타이머 대신 바로 다시 부른다(work-loop 4번: 처리 중인 이슈는 끊지 않는다). 쉬는 중 wake() 는 바로 부른다.
 * 사람이 직접 입력해 생긴 실행은 busy() 로 알린다 — 그 사이 타이머·wake 는 settled 까지 기다린다.
 *
 * none 확인(WP-1425): 모델이 규칙(none 은 신원 확인 멈춤·DRAIN·RESTART 에만)을 한 번 틀려도 AI 가 칸을 다시 띄울 때까지 죽지 않게,
 * none 을 받으면 checkStop 으로 상태를 확인한다 — 멈출 까닭(신원 아님·DRAIN·RESTART)이면 멈추고, 그 밖(RUN·확인 실패·시간 초과·reject)이면
 * missing 과 같은 기본 간격(DEFAULT_DELAY_MS)으로 다시 본다(인자를 지우지 않아 알림 wake() 도 계속 받는다). 잘못 쓴 none 이 연달아 오면
 * 간격을 두 배씩 늘린다(noneBackoffDelay) — none 이 아닌 답(at·missing)이나 start() 에서 횟수를 0 으로 되돌린다.
 * 확인은 비동기라 그 사이 start·stop·settled 가 오면 세대 번호(gen)를 올려 늦게 온 결과를 버린다. 쉬는 중 확인 중에 온 wake() 는
 * 진짜 알림(일이 생김)이므로 확인을 버리고 바로 부른다.
 */
export class LoopDriver {
  constructor({ run, setTimer, clearTimer, now = () => Date.now(), checkStop, onDecision }) {
    this.deps = { run, setTimer, clearTimer, now, checkStop, onDecision }
    this.args = undefined // 반복 중인 work-loop 인자(없으면 반복하지 않음)
    this.running = false // genia 가 지금 일하는 중(우리가 부른 것이든 사람이 넣은 것이든)
    this.pendingWake = false
    this.timer = undefined
    this.gen = 0 // 세대 번호 — none 확인을 시작할 때와 start·stop·wake·settled 마다 올려, 그 전에 시작한 확인의 결과를 버린다
    this.noneStreak = 0 // 잘못 쓴 none 으로 계속 돌기로 한 연달은 횟수(간격 늘리기용)
  }

  /** 반복 시작 — 인자를 기억하고 바로 한 번 부른다. 이미 일하는 중이면 끝난 뒤 부른다. 진행 중인 none 확인은 버린다. */
  start(args) {
    this.args = args
    this.noneStreak = 0
    this.gen++ // 진행 중인 none 확인은 버린다
    this.#clear()
    if (this.running) this.pendingWake = true
    else this.#invoke()
  }

  /** 반복 그만 — 인자를 비우고 타이머를 지운다(돌고 있는 부르기는 그대로 끝난다). 멈출 까닭이 확인된 GW-NEXT-CHECK none 도 이것으로 멈춘다. */
  stop() {
    this.args = undefined
    this.pendingWake = false
    this.gen++ // 진행 중인 none 확인은 버린다
    this.#clear()
  }

  /**
   * 알림(wake 줄) — 쉬는 중이면 바로 부르고, 일하는 중이면 끝난 뒤 한 번 부른다. 반복 중이 아니면(none 으로 멈춤 포함) 무시한다.
   * 쉬는 중 none 확인 중이면 확인을 버리고 바로 부른다 — 진짜 알림은 할 일이 생겼다는 뜻이라 확인 결과를 기다리지 않는다.
   */
  wake() {
    if (!this.args) return
    if (this.running) {
      this.pendingWake = true
      return
    }
    this.gen++ // 진행 중인 none 확인은 버린다
    this.#clear()
    this.#invoke()
  }

  /** genia 가 일을 시작했다(사람이 넣은 입력 포함) — 그 사이 타이머는 미룬다. */
  busy() {
    this.running = true
  }

  /**
   * genia 가 일을 마쳤다 — 마지막 답(text)에서 다음 확인을 읽어 잡는다. 반환: 이번에 정한 것(테스트·상태 줄용).
   * 'wake' — 모아 둔 깨움으로 바로 다시 부름, 'none' — 멈춤, 'timer' — delayMs 뒤 부름, 'idle' — 반복 중이 아니거나 이미 멈춤,
   * 'checking' — none 을 받아 checkStop 으로 확인하는 중(done: 결정 Promise — 버려진 확인이면 undefined 로 끝난다).
   */
  settled(text) {
    this.running = false
    // 앞서 시작한 none 확인이 있으면 버린다 — 이번 답이 더 새롭다.
    this.gen++
    // 반복 중이 아니면 아무것도 잡지 않는다. GW-NEXT-CHECK none 으로 멈춘 뒤(stop 으로 인자를 비웠다) 사람이 칸에 넣은 입력이 끝나도
    // (그 답엔 줄이 없어 'missing') 여기서 걸려 다시 돌지 않는다 — /gw-loop 를 다시 불러야 재개.
    if (!this.args) return { action: 'idle' }
    const next = parseNextCheck(text, this.deps.now())
    if (next.kind === 'none') {
      if (!this.deps.checkStop) {
        this.stop()
        return { action: 'none' }
      }
      return { action: 'checking', done: this.#checkNone() }
    }
    // none 이 아닌 답이면 잘못 쓴 none 의 연달은 횟수를 되돌린다.
    this.noneStreak = 0
    return this.#schedule(next.delayMs)
  }

  /**
   * 다음 부르기를 잡는다 — 모아 둔 깨움이 있으면 바로, 없으면 delayMs 뒤. settled 와 none 확인(RUN) 결정이 함께 쓴다.
   * 일하는 중이면(none 확인 중 사람이 넣은 일이 시작됨) 잡지 않는다 — 그 일이 끝날 때(settled) 잡는다('busy').
   */
  #schedule(delayMs) {
    if (this.running) return { action: 'busy' }
    if (this.pendingWake) {
      this.pendingWake = false
      this.#clear()
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
    }, delayMs)
    return { action: 'timer', delayMs }
  }

  /**
   * none 을 받았을 때 checkStop 으로 멈출지 확인한다. 그 사이 start·stop·wake·settled 가 오면 세대 번호가 바뀌어 결과를 버린다.
   * checkStop 이 reject 하면 멈추지 않는 쪽으로 본다 — 잘못 멈추는 것(조용히 죽음)이 20분 헛도는 것보다 나쁘다.
   */
  #checkNone() {
    this.#clear()
    const gen = ++this.gen
    // 계속 돌기로 하면 잡을 간격 — 확인 전에 정해 상태 보고에 다음 확인 시각으로 넘긴다.
    const delayMs = noneBackoffDelay(this.noneStreak)
    const nextCheckAt = new Date(this.deps.now() + delayMs).toISOString()
    const finish = (result) => (gen === this.gen ? this.#decide(result, delayMs) : undefined)
    return Promise.resolve()
      .then(() => this.deps.checkStop({ nextCheckAt }))
      .then(
        (r) => finish({ stop: Boolean(r?.stop), reason: String(r?.reason ?? '') }),
        () => finish({ stop: false, reason: 'error' }),
      )
  }

  /** none 확인 결과를 반영하고 onDecision 으로 알린다. delayMs — 계속 돌 때 잡을 간격. 반환: { stop, reason, action, delayMs? }. */
  #decide({ stop, reason }, delayMs) {
    let decision
    if (stop) {
      this.stop()
      decision = { stop, reason, action: 'none' }
    } else {
      // 잘못 쓴 none 으로 계속 돈다 — 연달은 횟수를 늘려 다음 none 의 간격을 두 배로 한다.
      this.noneStreak++
      decision = { stop, reason, ...this.#schedule(delayMs) }
    }
    this.deps.onDecision?.(decision)
    return decision
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

/** 확인 명령 하나의 결과 — 종료 코드(시간 초과·실행 실패면 null)와 표준 출력(조금만). 시간 초과면 그룹째 끝낸다. */
function execCommand(cmd, args, { timeoutMs }) {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    let timer
    const end = (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout: out })
    }
    let c
    try {
      // 자기 프로세스 그룹으로 띄워 시간 초과 때 그룹째(gw-status 가 부른 curl 까지) 끝낸다. 표준 오류는 버린다(보이지 않는다).
      c = nodeSpawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
    } catch {
      return end(null)
    }
    c.stdout.on('data', (d) => {
      if (out.length < 4096) out += d
    })
    c.on('error', () => end(null))
    c.on('close', (code) => end(typeof code === 'number' ? code : null))
    timer = setTimeout(() => {
      try {
        process.kill(-c.pid, 'SIGKILL')
      } catch {
        // 이미 끝났다.
      }
      end(null)
    }, timeoutMs)
  })
}

/**
 * GW-NEXT-CHECK none 을 정말 따를지 확인한다(WP-1425) — LoopDriver 의 checkStop 으로 genia 확장·Codex 구동기가 함께 쓴다.
 * 1. 신원: gw-lib.sh 의 gw_identity_key 가 확실히 실패(0 이 아닌 종료)하면 AI 키 신원이 아니다 → { stop: true, reason: 'identity' }
 *    (work-loop 1번 멈춤과 같은 경우 — 헛도는 루프를 막는다). 키 값은 셸 안에서 /dev/null 로 버리고 종료 코드만 본다.
 *    identity 'session'(genia, 기본) — $0 을 gw-lib.sh 경로로 넘겨 gw_identity 가 같은 폴더의 gw-session-key 로 이 세션의 선택(/gw-as)을 찾게 한다.
 *    identity 'env'(Codex 구동기) — 구동기의 readKey 처럼 $0 을 sh 로 두어 GENIA_WORKS_AS 만 본다. codex 는 구동기의 자식이지 조상이 아니라
 *    세션 찾기(조상 프로세스)가 엉뚱한 바깥 CLI 세션을 볼 수 있기 때문이다.
 * 2. 상태: gw-status IDLE "" <nextCheckAt> 의 첫 줄이 DRAIN·RESTART 면 { stop: true }, 그 밖(RUN·빈 값)은 { stop: false, reason: 'RUN' }.
 *    nextCheckAt(계속 돌 때 잡을 시각, ISO)을 함께 보고해 서버의 다음 확인 시각을 지우지 않는다(형식 검사는 gw-status 가 한다).
 * 실행 실패·시간 초과(timeoutMs 안에 둘을 모두 끝내야 한다 — 넘긴 명령은 그룹째 끝낸다)는 { stop: false, reason: 'error'|'timeout' } — 멈추지 않는 쪽.
 * 늘 이 시간 안에 답한다(LoopDriver 는 따로 시간 제한을 두지 않는다). exec(cmd, args, { timeoutMs }) → Promise<{ code: number|null, stdout }> 는 테스트용 주입 자리다.
 */
export async function checkStop({ scriptsDir, nextCheckAt, identity = 'session', exec = execCommand, timeoutMs = CHECK_STOP_TIMEOUT_MS, now = () => Date.now() }) {
  const deadline = now() + timeoutMs
  const left = () => Math.max(1, deadline - now())
  const failed = () => ({ stop: false, reason: deadline <= now() ? 'timeout' : 'error' })
  const idArgs =
    identity === 'env'
      ? ['-c', '. "$1/gw-lib.sh" && gw_identity_key >/dev/null 2>&1', 'sh', scriptsDir]
      : ['-c', '. "$0" && gw_identity_key >/dev/null 2>&1', scriptsDir + '/gw-lib.sh']
  try {
    const id = await exec('sh', idArgs, { timeoutMs: left() })
    if (id.code === null) return failed()
    if (id.code !== 0) return { stop: true, reason: 'identity' }
    const st = await exec(scriptsDir + '/gw-status', nextCheckAt ? ['IDLE', '', nextCheckAt] : ['IDLE'], { timeoutMs: left() })
    if (st.code === null) return failed()
    const desired = String(st.stdout ?? '').split(/\r?\n/)[0].trim()
    if (desired === 'DRAIN' || desired === 'RESTART') return { stop: true, reason: desired }
    return { stop: false, reason: 'RUN' }
  } catch {
    return { stop: false, reason: 'error' }
  }
}

/** none 확인 결정(LoopDriver onDecision)을 사람에게 보일 한 줄로 — genia 알림·Codex 구동기 로그가 같은 문구를 쓴다. 키 값은 담지 않는다. */
export function noneDecisionMessage(decision) {
  const { reason, action } = decision ?? {}
  if (action === 'none') {
    const why = reason === 'identity' ? 'AI 키 신원이 아님' : '상태 ' + reason
    return `다음 확인을 잡지 않습니다(GW-NEXT-CHECK none, ${why}) — 칸을 다시 띄우면 다시 시작합니다`
  }
  const state = reason === 'RUN' ? '상태가 RUN 이라' : '상태를 확인하지 못해'
  if (action === 'wake') return `GW-NEXT-CHECK none 이지만 ${state} 모아 둔 깨움으로 바로 다시 부릅니다`
  if (action === 'busy') return `GW-NEXT-CHECK none 이지만 ${state} 지금 일이 끝나면 다음 확인을 잡습니다`
  const minutes = Math.round((decision?.delayMs ?? DEFAULT_DELAY_MS) / 60000)
  return `GW-NEXT-CHECK none 이지만 ${state} ${minutes}분 뒤 다시 봅니다`
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

// 도구 입력에서 검사할 글 — Claude mod 와 같은 필드(경로·명령) + genia 의 codemode 스크립트(code·script)
// + OpenCode 의 파일 경로(read·write·edit 의 filePath — camelCase 라 mod 의 file_path 에 걸리지 않는다, WP-1410).
const SCRIPT_FIELDS = ['code', 'script', 'filePath']

/**
 * OpenCode apply_patch 의 patchText 에서 고칠 파일 경로만 뽑는다(WP-1410) — 「*** Add/Update/Delete File: 경로」·「*** Move to: 경로」 줄.
 * 패치 본문(바꿀 내용)에 키 저장소가 언급된 것까지 막지 않으려고 머리 줄만 본다(mod 가 content 를 보지 않는 것과 같은 까닭).
 */
function patchTargets(patchText) {
  if (typeof patchText !== 'string') return []
  const out = []
  for (const m of patchText.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) out.push(m[1].trim())
  return out
}

// 실행기마다 더 보는 도구 인자(WP-1410) — OpenCode bash 의 workdir(명령이 도는 폴더). 「workdir=키 저장소, command=cat keys/x」처럼
// 명령에는 키 저장소가 보이지 않는 우회를 막는다. genia·Codex 의 판정은 바꾸지 않으려고 실행기를 줄 때만 본다.
// (OpenCode 1.18.31 도구 인자: bash command·workdir, read·write·edit·lsp filePath, glob pattern·path, grep pattern·path·include, list path —
//  path·pattern 은 mod 와 같은 필드로, filePath 는 SCRIPT_FIELDS 로 이미 본다.)
const CLI_TARGET_FIELDS = { opencode: ['workdir'] }

/**
 * 키를 지키는 도구 차단 판정(KEY_PATH_DENY·HEADER_SCRIPT_DENY 대응) — 막아야 하면 사람에게 보일 이유, 아니면 undefined.
 * bash 는 헤더 스크립트 실행도 막는다(그 출력이 활성 AI 키다). 우회(다른 이름으로 복사해 실행 등)는 막지 못한다 — README 에 적는다.
 * cli: 부르는 실행기 — 없거나 genia 면 genia 문구(/gw-as 안내), opencode·codex 면 명령을 안내하지 않는 문구(RUNNER_*)를 낸다(WP-1410).
 *      opencode 면 bash 의 workdir 도 검사한다.
 */
export function toolBlockReason(toolName, input, { cli } = {}) {
  // genia 가 아닌 실행기(바깥 구동기 — codex·opencode)는 모두 /gw-as 같은 genia 명령이 없다.
  const external = Boolean(cli) && cli !== 'genia'
  const keyDeny = external ? RUNNER_KEY_PATH_DENY : GENIA_KEY_PATH_DENY
  const headerDeny = external ? RUNNER_HEADER_SCRIPT_DENY : GENIA_HEADER_SCRIPT_DENY
  const texts = [...toolTargets(input)]
  if (input && typeof input === 'object') {
    for (const k of [...SCRIPT_FIELDS, ...(CLI_TARGET_FIELDS[cli] ?? [])]) if (typeof input[k] === 'string') texts.push(input[k])
    texts.push(...patchTargets(input.patchText))
  }
  if (texts.some(isKeyPath)) return keyDeny
  if (isHeaderScriptCall(input)) return headerDeny
  // codemode 스크립트 안에서 헤더 스크립트를 부르는 것도 막는다(셸 명령처럼 실행 자리를 보지 않고 이름이 보이면).
  if (toolName === 'codemode' && texts.some((t) => /gw-(?:headers|session-key)\b/.test(t))) return headerDeny
  return undefined
}

/** 입력(프롬프트)에 키·토큰 모양이 있으면 true — 대화 기록에 남지 않게 버린다. */
export const promptHasSecret = containsSecretKey

// 프롬프트에서 키를 버릴 때의 문구 — 키 값은 담지 않는다.
export const GENIA_PROMPT_KEY_DROP = 'genia-works 키나 토큰은 대화에 넣을 수 없습니다 — AI 키는 /' + GENIA_COMMANDS.login + ' 으로 등록하세요'

// 바깥 구동기(Codex·OpenCode)가 MCP 토큰을 넘기는 환경 변수 — 그 프로그램 프로세스에만 넣고, 셸 도구에는 물려주지 않는다.
export const TOKEN_ENV = 'GENIA_WORKS_MCP_TOKEN'

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

/**
 * work-loop 를 부르는 프롬프트 — 플러그인 설치와 무관하게 스킬 파일을 직접 가리킨다(스킬은 Claude 플러그인과 한 벌).
 * 「이 스킬 폴더」를 알려 스킬 안의 `<이 스킬 폴더>/../../scripts/…` 경로가 풀리게 한다. 바깥 구동기(Codex·OpenCode)가 함께 쓴다.
 */
export function workLoopPrompt({ skillsDir, args }) {
  const dir = skillsDir + '/work-loop'
  return [
    `genia-works work-loop 스킬을 한 번 실행한다. 스킬 파일 ${dir}/SKILL.md 를 읽고 그대로 따른다(같은 폴더의 다른 .md 도 스킬이 가리키면 읽는다).`,
    `이 스킬 폴더는 ${dir} 이다. 인자: ${args}`,
  ].join('\n')
}

/**
 * 진행 요약에 넣을 미리보기 — 민감값을 먼저 숨긴 뒤 한 줄로 만든다(긴 토큰의 앞부분도 남기지 않는다). Codex·OpenCode 구동기가 함께 쓴다.
 */
export function safePreview(text) {
  // 셸 문자열의 이스케이프된 따옴표는 키·값 양쪽 경계로 인식해 JSON 인자의 비밀값도 가린다.
  const redacted = String(text)
    .replace(/\bBearer\s+[^\s"'`]+/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:[\w-]+_)?(?:token|api_key|password|secret)\b(?:\\*["'])?\s*[:=]\s*)(?:\\+"[\s\S]*?(?:\\+"|$)|\\+'[\s\S]*?(?:\\+'|$)|"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;"'`]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:ak_|swp_)[^\s"'`,;]+/g, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  // UTF-16 단위로 자르면 이모지가 깨지므로 120 Unicode code points 로 제한한다(WP-1423).
  return Array.from(redacted).slice(0, 120).join('')
}

/** 셸 한 단어로 감싼다(경로의 공백·따옴표). */
export function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}
