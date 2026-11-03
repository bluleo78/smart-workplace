// genia 확장의 순수 함수·반복 상태 기계 테스트(WP-1294) — genia 없이 node --test 로 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
