// genia 확장의 순수 함수·반복 상태 기계 테스트(WP-1294) — genia 없이 node --test 로 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  LoopDriver,
  parseNextCheck,
  clampDelay,
  classifyEventLine,
  eventsCommand,
  projectKeyOf,
  toolBlockReason,
  mcpConfig,
  tenantHeader,
  watchEvents,
  EVENTS_RESTART_MS,
  GENIA_KEY_PATH_DENY,
  GENIA_HEADER_SCRIPT_DENY,
  DEFAULT_DELAY_MS,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  CHECK_STOP_TIMEOUT_MS,
  noneBackoffDelay,
  checkStop,
  noneDecisionMessage,
} from '../genia/loop.js'

const NOW = Date.parse('2026-11-03T10:00:00Z')

test('parseNextCheck: 마지막 GW-NEXT-CHECK 줄의 시각까지(60초~1시간으로 자름), none 은 멈춤, 없으면 기본 20분', () => {
  assert.deepEqual(parseNextCheck('일을 마쳤다\nGW-NEXT-CHECK 2026-11-03T10:25:00Z', NOW), { kind: 'at', delayMs: 25 * 60 * 1000 })
  // 여러 번이면 마지막 것.
  assert.deepEqual(parseNextCheck('GW-NEXT-CHECK 2026-11-03T10:05:00Z\n…\nGW-NEXT-CHECK 2026-11-03T10:02:00Z', NOW).delayMs, 2 * 60 * 1000)
  // 백틱으로 감싸 써도 읽는다.
  assert.equal(parseNextCheck('`GW-NEXT-CHECK 2026-11-03T10:30:00+09:00`', NOW).kind, 'at')
  assert.deepEqual(parseNextCheck('GW-NEXT-CHECK none', NOW), { kind: 'none' })
  assert.deepEqual(parseNextCheck('끝', NOW), { kind: 'missing', delayMs: DEFAULT_DELAY_MS })
  assert.deepEqual(parseNextCheck('GW-NEXT-CHECK 내일', NOW), { kind: 'missing', delayMs: DEFAULT_DELAY_MS })
  // 지난 시각·너무 먼 시각은 자른다.
  assert.equal(parseNextCheck('GW-NEXT-CHECK 2026-11-03T09:00:00Z', NOW).delayMs, MIN_DELAY_MS)
  assert.equal(parseNextCheck('GW-NEXT-CHECK 2026-11-04T10:00:00Z', NOW).delayMs, MAX_DELAY_MS)
  // 줄 가운데 나온 것(설명 문장)은 줄로 보지 않는다.
  assert.equal(parseNextCheck('마지막 줄에 GW-NEXT-CHECK 2026-11-03T10:25:00Z 를 쓴다', NOW).kind, 'missing')
  assert.equal(clampDelay(5), MIN_DELAY_MS)
})

/** 가짜 genia — 부른 인자·걸린 타이머를 기록하고, 타이머는 손으로 돌린다. */
function harness() {
  const runs = []
  const timers = new Map()
  let seq = 0
  const d = new LoopDriver({
    run: (args) => runs.push(args),
    setTimer: (fn, ms) => {
      const h = ++seq
      timers.set(h, { fn, ms })
      return h
    },
    clearTimer: (h) => timers.delete(h),
    now: () => NOW,
  })
  const fire = () => {
    const [h, t] = [...timers.entries()][0]
    timers.delete(h)
    t.fn()
  }
  return { d, runs, timers, fire }
}

test('LoopDriver: 시작하면 바로 한 번 부르고, 끝나면 GW-NEXT-CHECK 로 다음 확인을 잡아 그때 다시 부른다', () => {
  const { d, runs, timers, fire } = harness()
  d.start('WP --queue "AI 개발팀"')
  assert.deepEqual(runs, ['WP --queue "AI 개발팀"'])
  assert.deepEqual(d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z'), { action: 'timer', delayMs: 20 * 60 * 1000 })
  assert.equal(timers.size, 1)
  fire()
  assert.equal(runs.length, 2)
})

test('LoopDriver: 일하는 중 온 깨움은 모았다가 끝나면 한 번만 바로 부르고, 쉬는 중 깨움은 타이머를 지우고 바로 부른다', () => {
  const { d, runs, timers } = harness()
  d.start('WP')
  d.wake()
  d.wake()
  assert.equal(runs.length, 1) // 하던 일을 끊지 않는다
  assert.deepEqual(d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z'), { action: 'wake' })
  assert.equal(runs.length, 2)
  assert.equal(timers.size, 0)
  d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z')
  assert.equal(timers.size, 1)
  d.wake()
  assert.equal(runs.length, 3)
  assert.equal(timers.size, 0) // 잡아 둔 확인은 지운다(겹쳐 부르지 않게)
})

test('LoopDriver: 타이머가 울릴 때 사람이 넣은 일이 돌고 있으면 겹쳐 부르지 않고 끝난 뒤 부른다', () => {
  const { d, runs, fire } = harness()
  d.start('WP')
  d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z')
  d.busy() // 사람이 칸에 직접 입력
  fire()
  assert.equal(runs.length, 1)
  assert.equal(d.settled('').action, 'wake')
  assert.equal(runs.length, 2)
})

test('LoopDriver: GW-NEXT-CHECK none 이면 멈추고 그 뒤 깨움도 무시한다, 다시 start 하면 이어 간다', () => {
  const { d, runs, timers } = harness()
  d.start('WP')
  assert.deepEqual(d.settled('GW-NEXT-CHECK none'), { action: 'none' })
  d.wake()
  assert.equal(runs.length, 1)
  assert.equal(timers.size, 0)
  d.start('WP')
  assert.equal(runs.length, 2)
})

test('LoopDriver: none 으로 멈춘 뒤 사람이 칸에 입력해 끝나도(줄 없음) 타이머를 걸지 않고 다시 부르지 않는다', () => {
  const { d, runs, timers } = harness()
  d.start('WP')
  d.settled('GW-NEXT-CHECK none')
  d.busy() // 사람이 칸에 직접 입력
  assert.deepEqual(d.settled('사람에게 한 답'), { action: 'idle' })
  assert.deepEqual([runs.length, timers.size], [1, 0])
  d.start('WP') // /gw-loop 를 다시 부를 때만 재개
  assert.equal(runs.length, 2)
})

test('LoopDriver: 지우지 못한 타이머가 멈춘 뒤 울려도 부르지 않는다', () => {
  const { d, runs, timers } = harness()
  d.start('WP')
  d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z')
  // 걸린 타이머의 콜백을 미리 잡아 둔다 — stop 이 지워도 이미 울리기 시작한 타이머(지우지 못한 것)를 흉내 낸다.
  const [[, t]] = [...timers]
  d.stop()
  t.fn()
  assert.equal(runs.length, 1)
  // none 으로 멈춘 경우도 같다.
  const h = harness()
  h.d.start('WP')
  h.d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z')
  const [[, t2]] = [...h.timers]
  h.d.busy()
  assert.deepEqual(h.d.settled('GW-NEXT-CHECK none'), { action: 'none' })
  t2.fn()
  assert.equal(h.runs.length, 1)
})

test('LoopDriver: 반복 중이 아니면 끝나도 아무것도 잡지 않는다(사람이 쓰는 genia 세션)', () => {
  const { d, runs, timers } = harness()
  d.busy()
  assert.deepEqual(d.settled('GW-NEXT-CHECK 2026-11-03T10:20:00Z'), { action: 'idle' })
  d.wake()
  assert.deepEqual([runs.length, timers.size], [0, 0])
})

test('알림 감시: start-agent 칸은 agent-events tail, 직접 띄운 세션은 gw-events, 줄은 wake·fatal·나머지로 나눈다', () => {
  assert.deepEqual(eventsCommand({ scriptsDir: '/p/scripts', agentDir: '/h/kodi', projectKey: 'WP' }), ['/p/scripts/agent-events', 'tail', '/h/kodi', 'WP'])
  assert.deepEqual(eventsCommand({ scriptsDir: '/p/scripts', projectKey: 'WP' }), ['/p/scripts/gw-events', 'WP'])
  assert.equal(classifyEventLine('wake WP-12 comment'), 'wake')
  assert.equal(classifyEventLine('wake - reconnect'), 'wake')
  assert.equal(classifyEventLine('gw-events: 인증 실패(HTTP 401) — 키를 확인하세요. 주기 확인만 합니다'), 'fatal')
  assert.equal(classifyEventLine('open WP started'), 'ignore')
  assert.equal(projectKeyOf('WP --queue "AI 개발팀"'), 'WP')
  assert.equal(projectKeyOf('  '), undefined)
  assert.equal(projectKeyOf('../x'), undefined)
})

/** 가짜 알림 감시 — spawn 한 자식(stdout 은 PassThrough)·kill·타이머를 기록한다. 진짜 프로세스·30초 기다림 없이 돈다. */
function eventsHarness(opts = {}) {
  const spawned = []
  const kills = []
  const timers = new Map()
  let seq = 0
  let pid = 1000
  const wakes = []
  const fatals = []
  const w = watchEvents({
    scriptsDir: '/p/scripts',
    projectKey: 'WP',
    onWake: (l) => wakes.push(l),
    onFatal: (l) => fatals.push(l),
    spawn: (cmd, args, options) => {
      const c = new EventEmitter()
      c.stdout = new PassThrough()
      c.pid = ++pid
      spawned.push({ cmd, args, options, child: c })
      return c
    },
    kill: (p, sig) => kills.push([p, sig]),
    setTimer: (fn, ms) => {
      const h = ++seq
      timers.set(h, { fn, ms })
      return h
    },
    clearTimer: (h) => timers.delete(h),
    ...opts,
  })
  const fire = () => {
    const [h, t] = [...timers.entries()][0]
    timers.delete(h)
    t.fn()
  }
  return { w, spawned, kills, timers, wakes, fatals, fire }
}

// readline 의 line 은 다음 차례에 나온다 — 단언 전에 한 번 기다린다.
const tick = () => new Promise((r) => setImmediate(r))

test('watchEvents: 자기 그룹(detached)으로 띄워 wake 줄은 onWake, 나머지 줄은 버리고, 끝나면 30초 뒤 다시 띄운다', async () => {
  const { w, spawned, timers, wakes, fatals, fire } = eventsHarness()
  assert.equal(spawned.length, 1)
  assert.deepEqual([spawned[0].cmd, spawned[0].args], ['/p/scripts/gw-events', ['WP']])
  assert.equal(spawned[0].options.detached, true)
  assert.equal(w.running, true)
  spawned[0].child.stdout.write('open WP started\nwake WP-12 comment\n')
  await tick()
  assert.deepEqual([wakes, fatals], [['wake WP-12 comment'], []])
  spawned[0].child.emit('exit', 1)
  assert.equal(w.running, false)
  assert.deepEqual([...timers.values()].map((t) => t.ms), [EVENTS_RESTART_MS])
  fire()
  assert.equal(spawned.length, 2)
  assert.equal(w.running, true)
})

test('watchEvents: fatal 줄(gw-events: …)이면 onFatal 뒤 끝나도 다시 띄우지 않는다', async () => {
  const { w, spawned, timers, fatals } = eventsHarness()
  spawned[0].child.stdout.write('gw-events: 인증 실패(HTTP 401)\n')
  await tick()
  assert.deepEqual(fatals, ['gw-events: 인증 실패(HTTP 401)'])
  spawned[0].child.emit('exit', 1)
  assert.deepEqual([timers.size, spawned.length, w.running], [0, 1, false])
})

test('watchEvents: stop 은 감시 그룹째(-pid) 끝내고 재시작 대기도 지운다, shouldRestart 가 거짓이면 다시 띄우지 않는다', () => {
  const a = eventsHarness()
  const pid = a.spawned[0].child.pid
  a.w.stop()
  assert.deepEqual(a.kills, [[-pid, 'SIGTERM']])
  a.spawned[0].child.emit('exit', null) // 끝낸 뒤 오는 exit 는 재시작을 걸지 않는다
  assert.deepEqual([a.timers.size, a.w.running], [0, false])

  const b = eventsHarness()
  b.spawned[0].child.emit('exit', 0)
  assert.equal(b.timers.size, 1)
  b.w.stop() // 재시작 대기 중 stop — 타이머를 지우고, 떠 있는 자식이 없어 kill 하지 않는다
  assert.deepEqual([b.timers.size, b.kills.length], [0, 0])

  const c = eventsHarness({ shouldRestart: () => false })
  c.spawned[0].child.emit('exit', 0)
  assert.deepEqual([c.timers.size, c.spawned.length], [0, 1])
})

test('tenantHeader: 숫자 워크스페이스만 X-On-Behalf-Of-Tenant 로, 그 밖에는 빈 객체', () => {
  assert.deepEqual(tenantHeader('7'), { 'X-On-Behalf-Of-Tenant': '7' })
  assert.deepEqual(tenantHeader('7; x'), {})
  assert.deepEqual(tenantHeader(''), {})
  assert.deepEqual(tenantHeader(undefined), {})
})

test('toolBlockReason: 키 저장소 경로·헤더 스크립트 실행은 bash·read·write·codemode 모두 막고, 평범한 호출은 둔다', () => {
  const home = '/Users/x/.genia-works/keys/kodi'
  assert.equal(toolBlockReason('bash', { command: `cat ${home}` }), GENIA_KEY_PATH_DENY)
  assert.equal(toolBlockReason('read', { path: home }), GENIA_KEY_PATH_DENY)
  assert.equal(toolBlockReason('write', { path: '/Users/x/.genia-works/sessions/1' , content: 'x' }), GENIA_KEY_PATH_DENY)
  assert.equal(toolBlockReason('codemode', { code: `await fs.readFile("${home}")` }), GENIA_KEY_PATH_DENY)
  assert.equal(toolBlockReason('bash', { command: '/p/scripts/gw-headers --authorization' }), GENIA_HEADER_SCRIPT_DENY)
  assert.equal(toolBlockReason('codemode', { code: 'await exec("/p/scripts/gw-headers")' }), GENIA_HEADER_SCRIPT_DENY)
  assert.equal(toolBlockReason('bash', { command: 'git status' }), undefined)
  // 쓰는 내용에 경로가 언급된 것은 막지 않는다(문서 작성 등).
  assert.equal(toolBlockReason('write', { path: '/r/README.md', content: '키는 ~/.genia-works 에 둔다' }), undefined)
  assert.ok(GENIA_HEADER_SCRIPT_DENY.includes('/gw-as'))
})

test('mcpConfig: AI 신원이면 헤더 스크립트 명령으로 키를 읽고, 내 토큰이면 받아 둔 값, 워크스페이스는 숫자일 때만, User-Agent 는 genia', () => {
  const ai = mcpConfig({ url: 'https://w/mcp', scriptsDir: "/a b/it's/scripts", aiIdentity: 'kodi', myToken: undefined, tenant: '7', version: '0.1.34' })
  assert.equal(ai.headers.Authorization, `!'/a b/it'\\''s/scripts/gw-headers' --authorization`)
  assert.equal(ai.headers['X-On-Behalf-Of-Tenant'], '7')
  assert.equal(ai.headers['User-Agent'], 'genia/0.1.34')
  const me = mcpConfig({ url: 'https://w/mcp', scriptsDir: '/s', aiIdentity: '', myToken: 'swp_x', tenant: '7; rm', version: '1' })
  assert.equal(me.headers.Authorization, 'Bearer swp_x')
  assert.equal(me.headers['X-On-Behalf-Of-Tenant'], undefined)
  assert.equal(mcpConfig({ url: 'u', scriptsDir: '/s', aiIdentity: '' }).headers.Authorization, 'Bearer invalid')
})

test('genia 패키지 목록: 확장과 스킬을 이 플러그인 폴더에서 그대로 가리킨다(스킬 사본 없음)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(pkg.pi, { extensions: ['./genia/index.ts'], skills: ['./skills'] })
  assert.equal(pkg.dependencies, undefined) // genia 가 주는 모듈은 묶지 않는다
})

test('conflictingMcpEntry: 손으로 적은 genia-works(이름의 - · _ 차이 포함) 항목을 찾고, 깨진 JSON 은 없는 것으로 본다', async () => {
  const { conflictingMcpEntry } = await import('../genia/loop.js')
  assert.equal(conflictingMcpEntry('{"mcpServers":{"genia-works":{"url":"x"}}}'), 'genia-works')
  assert.equal(conflictingMcpEntry('{"mcpServers":{"Genia_Works":{"url":"x"}}}'), 'Genia_Works')
  assert.equal(conflictingMcpEntry('{"mcpServers":{"github":{}}}'), undefined)
  assert.equal(conflictingMcpEntry('{'), undefined)
})

/** none 확인(WP-1425)용 가짜 genia — checkStop 결과를 손으로 정하고(resolve·reject), onDecision 을 기록한다. */
function checkHarness() {
  const runs = []
  const timers = new Map()
  const decisions = []
  const checks = []
  let seq = 0
  const d = new LoopDriver({
    run: (args) => runs.push(args),
    setTimer: (fn, ms) => {
      const h = ++seq
      timers.set(h, { fn, ms })
      return h
    },
    clearTimer: (h) => timers.delete(h),
    now: () => NOW,
    checkStop: (input) =>
      new Promise((resolve, reject) => {
        checks.push({ resolve, reject, input })
      }),
    onDecision: (x) => decisions.push(x),
  })
  // 확인을 시작해 결정 Promise 를 돌려준다 — 결과는 checks.at(-1) 로 정한다.
  const settleNone = () => {
    const r = d.settled('끝\nGW-NEXT-CHECK none')
    assert.equal(r.action, 'checking')
    return r.done
  }
  // checkStop 은 다음 마이크로태스크에서 불린다 — 결과를 정하기 전에 한 번 기다린다.
  const tick = () => new Promise((r) => setImmediate(r))
  // 걸린 타이머 하나를 울린다(다음 확인 타이머).
  const fire = () => {
    const [h, t] = [...timers.entries()][0]
    timers.delete(h)
    t.fn()
  }
  return { d, runs, timers, decisions, checks, settleNone, tick, fire }
}

test('LoopDriver none 확인: 상태가 RUN 이면 멈추지 않고 기본 20분 타이머, 그 뒤 깨움도 바로 부른다(WP-1425)', async () => {
  const { d, runs, timers, decisions, checks, settleNone, tick } = checkHarness()
  d.start('WP')
  const done = settleNone()
  await tick()
  assert.equal(timers.size, 0) // 확인 중엔 타이머가 없다(시간 제한은 checkStop 이 진다)
  // 계속 돌 때 잡을 시각을 넘겨 상태 보고가 서버의 다음 확인 시각을 지우지 않게 한다.
  assert.deepEqual(checks[0].input, { nextCheckAt: new Date(NOW + DEFAULT_DELAY_MS).toISOString() })
  checks[0].resolve({ stop: false, reason: 'RUN' })
  const decision = await done
  assert.deepEqual(decision, { stop: false, reason: 'RUN', action: 'timer', delayMs: DEFAULT_DELAY_MS })
  assert.deepEqual(decisions, [decision])
  assert.deepEqual([...timers.values()].map((t) => t.ms), [DEFAULT_DELAY_MS])
  assert.equal(noneDecisionMessage(decision), 'GW-NEXT-CHECK none 이지만 상태가 RUN 이라 20분 뒤 다시 봅니다')
  d.wake()
  assert.equal(runs.length, 2)
  assert.equal(timers.size, 0)
})

test('LoopDriver none 확인: DRAIN·RESTART·신원 아님이면 멈추고 타이머 없이 깨움도 무시한다', async () => {
  for (const reason of ['DRAIN', 'RESTART', 'identity']) {
    const { d, runs, timers, checks, settleNone, tick } = checkHarness()
    d.start('WP')
    const done = settleNone()
    await tick()
    checks[0].resolve({ stop: true, reason })
    assert.deepEqual(await done, { stop: true, reason, action: 'none' })
    assert.equal(timers.size, 0)
    d.wake()
    assert.equal(runs.length, 1)
  }
  assert.ok(noneDecisionMessage({ stop: true, reason: 'DRAIN', action: 'none' }).includes('다음 확인을 잡지 않습니다'))
  assert.ok(noneDecisionMessage({ stop: true, reason: 'identity', action: 'none' }).includes('AI 키 신원이 아님'))
})

test('LoopDriver none 확인: checkStop 이 실패(reject)하면 멈추지 않는다', async () => {
  const a = checkHarness()
  a.d.start('WP')
  const done = a.settleNone()
  await a.tick()
  a.checks[0].reject(new Error('x'))
  assert.deepEqual(await done, { stop: false, reason: 'error', action: 'timer', delayMs: DEFAULT_DELAY_MS })
  assert.ok(noneDecisionMessage(await done).includes('상태를 확인하지 못해 20분 뒤'))
  assert.ok(noneDecisionMessage({ stop: false, reason: 'timeout', action: 'timer', delayMs: DEFAULT_DELAY_MS }).includes('상태를 확인하지 못해'))
})

test('LoopDriver none 확인: 쉬는 중 확인 중에 온 깨움은 확인을 버리고 바로 부르며, 늦게 온 결과는 버린다', async () => {
  const a = checkHarness()
  a.d.start('WP')
  const done = a.settleNone()
  a.d.wake()
  assert.equal(a.runs.length, 2) // 진짜 알림 — 확인을 기다리지 않는다
  assert.equal(a.timers.size, 0)
  await a.tick()
  a.checks[0].resolve({ stop: true, reason: 'DRAIN' })
  assert.equal(await done, undefined)
  assert.equal(a.decisions.length, 0)
  assert.equal(a.d.args, 'WP') // 늦은 DRAIN 으로 멈추지 않는다
})

test('LoopDriver none 확인: 잘못 쓴 none 이 연달아 오면 간격을 20→40→60분으로 늘리고, none 이 아닌 답·start 에서 되돌린다', async () => {
  assert.deepEqual([0, 1, 2, 3].map(noneBackoffDelay), [DEFAULT_DELAY_MS, 2 * DEFAULT_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS])
  const { d, timers, checks, settleNone, tick, fire } = checkHarness()
  const round = async () => {
    const done = settleNone()
    await tick()
    checks.at(-1).resolve({ stop: false, reason: 'RUN' })
    return done
  }
  d.start('WP')
  const delays = []
  for (let i = 0; i < 3; i++) {
    const r = await round()
    delays.push(r.delayMs)
    assert.deepEqual([...timers.values()].map((t) => t.ms), [r.delayMs])
    fire()
  }
  assert.deepEqual(delays, [20, 40, 60].map((m) => m * 60 * 1000))
  assert.equal(noneDecisionMessage({ stop: false, reason: 'RUN', action: 'timer', delayMs: delays[1] }), 'GW-NEXT-CHECK none 이지만 상태가 RUN 이라 40분 뒤 다시 봅니다')
  assert.equal(checks.at(-1).input.nextCheckAt, new Date(NOW + MAX_DELAY_MS).toISOString())
  // none 이 아닌 답이면 되돌린다.
  d.settled('끝')
  fire()
  assert.equal((await round()).delayMs, DEFAULT_DELAY_MS)
  fire()
  assert.equal((await round()).delayMs, 2 * DEFAULT_DELAY_MS)
  // start 도 되돌린다.
  d.start('WP')
  assert.equal((await round()).delayMs, DEFAULT_DELAY_MS)
})

test('LoopDriver none 확인: 확인 중 stop() 이면 결정이 와도 다시 돌지 않고, start() 면 새로 부른 뒤 늦은 결정은 버린다', async () => {
  const a = checkHarness()
  a.d.start('WP')
  const done = a.settleNone()
  a.d.stop()
  await a.tick()
  a.checks[0].resolve({ stop: false, reason: 'RUN' })
  assert.equal(await done, undefined)
  assert.deepEqual([a.runs.length, a.timers.size, a.decisions.length], [1, 0, 0])
  a.d.wake()
  assert.equal(a.runs.length, 1)
  const b = checkHarness()
  b.d.start('WP')
  const done2 = b.settleNone()
  b.d.start('WP')
  assert.equal(b.runs.length, 2)
  await b.tick()
  b.checks[0].resolve({ stop: true, reason: 'DRAIN' })
  assert.equal(await done2, undefined)
  assert.equal(b.d.args, 'WP') // 늦은 DRAIN 으로 새 반복을 멈추지 않는다
  assert.equal(b.timers.size, 0)
})

test('LoopDriver none 확인: 확인 중 사람이 넣은 일이 돌면 RUN 결정은 아무것도 잡지 않고, 그 일이 끝날 때 잡는다', async () => {
  const { d, runs, timers, checks, settleNone, tick } = checkHarness()
  d.start('WP')
  const done = settleNone()
  d.busy()
  await tick()
  checks[0].resolve({ stop: false, reason: 'RUN' })
  assert.equal((await done).action, 'busy')
  assert.deepEqual([runs.length, timers.size], [1, 0])
  assert.deepEqual(d.settled('사람에게 한 답'), { action: 'timer', delayMs: DEFAULT_DELAY_MS })
  // 확인 중 settled 가 다시 오면(사람 입력이 먼저 끝남) 앞선 확인은 버린다.
  const h = checkHarness()
  h.d.start('WP')
  const done2 = h.settleNone()
  h.d.busy()
  h.d.settled('사람에게 한 답')
  await h.tick()
  h.checks[0].resolve({ stop: true, reason: 'DRAIN' })
  assert.equal(await done2, undefined)
  assert.equal(h.d.args, 'WP')
})

test('LoopDriver: checkStop 이 없으면 none 은 예전처럼 바로 멈춘다', () => {
  const { d, runs, timers } = harness()
  d.start('WP')
  assert.deepEqual(d.settled('GW-NEXT-CHECK none'), { action: 'none' })
  d.wake()
  assert.deepEqual([runs.length, timers.size], [1, 0])
})

test('checkStop: 신원 실패는 identity 로 멈춤, gw-status 의 DRAIN·RESTART 는 멈춤, RUN·실행 실패·시간 초과는 계속', async () => {
  const fake = (identityCode, status) => {
    const calls = []
    const exec = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      if (cmd === 'sh') return { code: identityCode, stdout: '' }
      if (status instanceof Error) throw status
      return status
    }
    return { exec, calls }
  }
  const run = async (identityCode, status, extra = {}) => {
    const f = fake(identityCode, status)
    return { r: await checkStop({ scriptsDir: '/p/scripts', exec: f.exec, ...extra }), calls: f.calls }
  }
  const id = await run(1, { code: 0, stdout: 'RUN\n' })
  assert.deepEqual(id.r, { stop: true, reason: 'identity' })
  assert.equal(id.calls.length, 1) // 신원이 아니면 상태 보고를 하지 않는다
  // 키 값은 셸 안에서 버리고, $0 을 gw-lib.sh 로 두어 이 세션 선택을 찾게 한다.
  assert.ok(id.calls[0].args[1].includes('gw_identity_key >/dev/null'))
  assert.equal(id.calls[0].args[2], '/p/scripts/gw-lib.sh')
  assert.deepEqual((await run(0, { code: 0, stdout: 'DRAIN\n' })).r, { stop: true, reason: 'DRAIN' })
  assert.deepEqual((await run(0, { code: 0, stdout: 'RESTART\n' })).r, { stop: true, reason: 'RESTART' })
  const ok = await run(0, { code: 0, stdout: 'RUN\n' })
  assert.deepEqual(ok.r, { stop: false, reason: 'RUN' })
  assert.deepEqual([ok.calls[1].cmd, ok.calls[1].args], ['/p/scripts/gw-status', ['IDLE']])
  assert.ok(ok.calls[1].opts.timeoutMs <= CHECK_STOP_TIMEOUT_MS)
  // 다음 확인 시각을 함께 보고한다(서버의 값을 지우지 않게). 시각 형식이 아니면 넘기지 않는다.
  const at = '2026-11-03T10:20:00.000Z'
  assert.deepEqual((await run(0, { code: 0, stdout: 'RUN' }, { nextCheckAt: at })).calls[1].args, ['IDLE', '', at])
  // identity 'env'(Codex 구동기) — readKey 처럼 $0 을 sh 로 두어 GENIA_WORKS_AS 만 본다. 키는 여기서도 버린다.
  const env = await run(1, { code: 0, stdout: 'RUN' }, { identity: 'env' })
  assert.deepEqual(env.r, { stop: true, reason: 'identity' })
  assert.deepEqual(env.calls[0].args.slice(2), ['sh', '/p/scripts'])
  assert.ok(env.calls[0].args[1].includes('gw_identity_key >/dev/null'))
  assert.deepEqual((await run(0, { code: 0, stdout: '' })).r, { stop: false, reason: 'RUN' })
  assert.deepEqual((await run(0, new Error('spawn'))).r, { stop: false, reason: 'error' })
  assert.deepEqual((await run(null, { code: 0, stdout: 'DRAIN' })).r, { stop: false, reason: 'error' })
  // 시간 초과 — 남은 시간이 없으면 timeout.
  let t = 0
  const slow = async () => {
    t += 30_000
    return { code: null, stdout: '' }
  }
  assert.deepEqual(await checkStop({ scriptsDir: '/p', exec: slow, now: () => t }), { stop: false, reason: 'timeout' })
})

test('checkStop: 진짜 스크립트로 — 키가 없는 신원은 identity, 등록된 키·Works 밖이면 RUN(키는 출력되지 않는다)', async () => {
  const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
  const home = join(mkdtempSync(join(tmpdir(), 'gw-check-')), 'home')
  mkdirSync(home)
  assert.equal(spawnSync(join(scripts, 'gw-keys'), ['add', 'kodi'], { input: 'ak_FAKE_CHECK_1\n', env: { PATH: process.env.PATH, HOME: home } }).status, 0)
  const saved = { HOME: process.env.HOME, AS: process.env.GENIA_WORKS_AS, GEN: process.env.GENIA_AGENT_GENERATION }
  try {
    process.env.HOME = home
    delete process.env.GENIA_AGENT_GENERATION
    process.env.GENIA_WORKS_AS = 'nobody'
    assert.deepEqual(await checkStop({ scriptsDir: scripts }), { stop: true, reason: 'identity' })
    process.env.GENIA_WORKS_AS = 'kodi'
    assert.deepEqual(await checkStop({ scriptsDir: scripts }), { stop: false, reason: 'RUN' })
  } finally {
    for (const [k, v] of [['HOME', saved.HOME], ['GENIA_WORKS_AS', saved.AS], ['GENIA_AGENT_GENERATION', saved.GEN]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})
