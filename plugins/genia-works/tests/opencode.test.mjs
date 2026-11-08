// OpenCode 구동기·키 보호 플러그인 테스트(WP-1410) — 진짜 opencode 없이 가짜 opencode(GW_OPENCODE)로 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  RunReader,
  TOKEN_ENV,
  configContent,
  guardHooks,
  isSessionNotFound,
  lastAnswer,
  nextSession,
  opencodeArgs,
  progressSummaryFrom,
  sessionIdFrom,
} from '../opencode/lib.mjs'
import { GENIA_HEADER_SCRIPT_DENY, GENIA_KEY_PATH_DENY, RUNNER_HEADER_SCRIPT_DENY, RUNNER_KEY_PATH_DENY, toolBlockReason } from '../genia/loop.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ev = (o) => JSON.stringify({ sessionID: 'ses_1', ...o })

test('configContent: MCP(토큰은 {env:} 치환)·워크스페이스·User-Agent·무승인·키 보호 플러그인을 OPENCODE_CONFIG_CONTENT 로 낸다', () => {
  const c = JSON.parse(configContent({ mcpUrl: 'https://w/mcp', tenant: '7', version: '0.1.43', guardPluginPath: '/p q/opencode/guard-plugin.js' }))
  assert.equal(c.permission, 'allow')
  // LSP·포매터는 shell.env 를 거치지 않아 키를 물려받으므로 끈다.
  assert.equal(c.lsp, false)
  assert.equal(c.formatter, false)
  // 경로의 공백은 file:// 주소로 감싼다.
  assert.deepEqual(c.plugin, ['file:///p%20q/opencode/guard-plugin.js'])
  assert.deepEqual(c.mcp['genia-works'], {
    type: 'remote',
    url: 'https://w/mcp',
    oauth: false,
    headers: { Authorization: `Bearer {env:${TOKEN_ENV}}`, 'User-Agent': 'opencode/genia-works-0.1.43', 'X-On-Behalf-Of-Tenant': '7' },
  })
  // 숫자가 아닌 워크스페이스는 붙이지 않고, 버전이 없으면 0.
  const other = JSON.parse(configContent({ mcpUrl: 'u', tenant: '7; x', guardPluginPath: '/g.js' }))
  assert.deepEqual(other.mcp['genia-works'].headers, { Authorization: `Bearer {env:${TOKEN_ENV}}`, 'User-Agent': 'opencode/genia-works-0' })
})

test('opencodeArgs: 처음은 run --format json <프롬프트>, 세션이 있으면 -s <세션>', () => {
  assert.deepEqual(opencodeArgs({ prompt: 'P' }), ['run', '--format', 'json', 'P'])
  assert.deepEqual(opencodeArgs({ session: 'ses_1', prompt: 'P' }), ['run', '--format', 'json', '-s', 'ses_1', 'P'])
})

test('sessionIdFrom·lastAnswer: 세션 id 를 읽고, tool-calls 가 아닌 마지막 단계의 글만 답으로 본다', () => {
  assert.equal(sessionIdFrom(ev({ type: 'step_start' })), 'ses_1')
  for (const l of ['경고', 'null', '[]', '{}', '{"sessionID":7}']) assert.equal(sessionIdFrom(l), undefined)
  const lines = [
    ev({ type: 'step_start' }),
    ev({ type: 'text', part: { text: '도구를 부르기 전 설명' } }),
    ev({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'OUTPUT_PRIVATE' } } }),
    ev({ type: 'step_finish', part: { reason: 'tool-calls' } }),
    ev({ type: 'step_start' }),
    ev({ type: 'text', part: { text: '끝' } }),
    ev({ type: 'text', part: { text: 'GW-NEXT-CHECK none' } }),
    ev({ type: 'step_finish', part: { reason: 'stop' } }),
    'not json',
  ]
  assert.equal(lastAnswer(lines), '끝\nGW-NEXT-CHECK none')
  // tool-calls 로 끝난 중간 단계뿐이면(오류로 끝남) 답이 없다.
  const r = new RunReader()
  for (const l of lines.slice(0, 4)) r.add(l)
  assert.equal(r.answer, '')
  assert.equal(r.session, 'ses_1')
})

test('RunReader: tool-calls 가 아닌 마지막 단계(length·other·unknown·reason 없음)에서도 답을 굳힌다 — GW-NEXT-CHECK 를 잃지 않게', () => {
  for (const reason of ['stop', 'length', 'other', 'unknown', 'content-filter', undefined]) {
    const lines = [
      ev({ type: 'step_start' }),
      ev({ type: 'text', part: { text: '중간' } }),
      ev({ type: 'step_finish', part: { reason: 'tool-calls' } }),
      ev({ type: 'step_start' }),
      ev({ type: 'text', part: { text: '마무리' } }),
      ev({ type: 'text', part: { text: 'GW-NEXT-CHECK none' } }),
      ev({ type: 'step_finish', part: reason === undefined ? {} : { reason } }),
    ]
    assert.equal(lastAnswer(lines), '마무리\nGW-NEXT-CHECK none', String(reason))
  }
})

test('RunReader.finish: 단계가 끝나지 않고 회차가 끝나면(끊김) 마지막 단계의 글을 답으로 굳힌다 — tool-calls 로 끝난 단계의 글은 아니다', () => {
  const r = new RunReader()
  r.add(ev({ type: 'step_start' }))
  r.add(ev({ type: 'text', part: { text: '도구 전 설명' } }))
  r.add(ev({ type: 'step_finish', part: { reason: 'tool-calls' } }))
  r.finish()
  assert.equal(r.answer, '')
  r.add(ev({ type: 'step_start' }))
  r.add(ev({ type: 'text', part: { text: 'GW-NEXT-CHECK none' } }))
  r.finish()
  assert.equal(r.answer, 'GW-NEXT-CHECK none')
  // 끝난 단계의 답은 finish 가 지우지 않는다.
  const done = new RunReader()
  for (const l of [ev({ type: 'step_start' }), ev({ type: 'text', part: { text: '답' } }), ev({ type: 'step_finish', part: { reason: 'stop' } })]) done.add(l)
  done.finish()
  assert.equal(done.answer, '답')
})

test('RunReader: 줄마다 진행 요약을 돌려주고, 출력 없이 끝난 회차의 reader 는 세션을 모른다(다음 세션은 nextSession 이 정한다)', () => {
  const r = new RunReader()
  assert.equal(r.add(ev({ type: 'text', part: { text: '조사 중' } })), '답변: 조사 중')
  assert.equal(r.add('Error: Session not found'), undefined)
  // 없는 세션으로 이어 받으면 opencode 는 stdout 에 아무것도 내지 않고 종료 1 — 그 회차의 reader 는 세션을 모른다.
  const failed = new RunReader()
  assert.equal(failed.session, undefined)
  assert.equal(failed.answer, '')
  assert.ok(!opencodeArgs({ session: failed.session, prompt: 'P' }).includes('-s'))
})

test('nextSession: 본 세션이 있으면 그것, 「Session not found」면 새 세션, 출력 없이 끝난 다른 실패면 앞의 세션을 그대로 둔다', () => {
  assert.equal(nextSession({ previous: 'ses_1', seen: 'ses_2', notFound: false }), 'ses_2')
  assert.equal(nextSession({ previous: 'ses_1', seen: undefined, notFound: true }), undefined)
  // 모델 서버 장애·설정 오류처럼 출력 없이 끝나도 맥락(세션)을 버리지 않는다.
  assert.equal(nextSession({ previous: 'ses_1', seen: undefined, notFound: false }), 'ses_1')
  assert.equal(nextSession({ previous: undefined, seen: undefined, notFound: false }), undefined)
  // 세션 안에서 오류로 끝난 회차(문맥 넘침 등)는 그 세션을 버린다 — 같은 오류를 되풀이하지 않게.
  assert.equal(nextSession({ previous: 'ses_1', seen: 'ses_1', notFound: false, failed: true }), undefined)
  const r = new RunReader()
  r.add(JSON.stringify({ sessionID: 'ses_1', type: 'error', error: { name: 'ContextOverflow' } }))
  assert.equal(r.failed, true)
  assert.ok(isSessionNotFound('Error: Session not found'))
  assert.ok(!isSessionNotFound('Error: connect ECONNREFUSED 10.0.0.1:443'))
})

test('진행 요약: bash 명령·도구 이름·할 일·답·오류만, 도구 출력·인자는 내지 않는다', () => {
  const tool = (tool, input, status = 'completed') => progressSummaryFrom(ev({ type: 'tool_use', part: { tool, state: { status, input, output: 'OUTPUT_PRIVATE' } } }))
  assert.equal(tool('bash', { command: 'git status token=TOKEN_PRIVATE' }), '명령 실행: git status token=[REDACTED]')
  assert.equal(tool('bash', { command: 'cat x' }, 'error'), '명령 실행: cat x (실패)')
  assert.equal(tool('genia-works_list_issues', { value: 'ARGS_PRIVATE' }), '도구 호출: genia-works_list_issues')
  assert.equal(tool('read', { filePath: '/secret/PATH_PRIVATE' }), '도구 호출: read')
  assert.equal(tool('todowrite', { todos: [{ content: 'TODO_PRIVATE', status: 'completed' }, { content: 'x', status: 'pending' }] }), '할 일: 1/2 완료')
  assert.equal(tool('todowrite', { todos: [null] }), undefined)
  assert.equal(progressSummaryFrom(ev({ type: 'text', part: { text: '진행 중\n다음 ak_KEY_PRIVATE' } })), '답변: 진행 중 다음 [REDACTED]')
  assert.equal(progressSummaryFrom(ev({ type: 'error', error: { name: 'APIError', data: { message: 'Bearer BEARER_PRIVATE 거절' } } })), '오류: APIError Bearer [REDACTED] 거절')
  for (const l of ['not json', 'null', ev({ type: 'step_start' }), ev({ type: 'step_finish', part: { reason: 'stop' } }), ev({ type: 'tool_use', part: {} }), ev({ type: 'text', part: { text: '  ' } })]) {
    assert.equal(progressSummaryFrom(l), undefined)
  }
})

test('toolBlockReason: OpenCode 도구 인자(bash command·workdir·read/write/edit filePath·glob/grep/list pattern·path·apply_patch 머리 줄)의 키 저장소·헤더 스크립트를 막는다', () => {
  const key = '/Users/x/.genia-works/keys/kodi'
  const oc = (tool, input) => toolBlockReason(tool, input, { cli: 'opencode' })
  assert.equal(oc('bash', { command: `cat ${key}` }), RUNNER_KEY_PATH_DENY)
  assert.equal(oc('bash', { command: '/p/scripts/gw-headers --authorization' }), RUNNER_HEADER_SCRIPT_DENY)
  for (const t of ['read', 'write', 'edit']) assert.equal(oc(t, { filePath: key }), RUNNER_KEY_PATH_DENY, t)
  assert.equal(oc('glob', { pattern: '~/.genia-works/**' }), RUNNER_KEY_PATH_DENY)
  assert.equal(oc('grep', { pattern: 'x', path: '/Users/x/.genia-works' }), RUNNER_KEY_PATH_DENY)
  assert.equal(oc('list', { path: '/Users/x/.genia-works' }), RUNNER_KEY_PATH_DENY)
  assert.equal(oc('apply_patch', { patchText: `*** Begin Patch\n*** Update File: ${key}\n@@\n-a\n+b\n*** End Patch` }), RUNNER_KEY_PATH_DENY)
  assert.equal(oc('apply_patch', { patchText: `*** Begin Patch\n*** Update File: /r/a.md\n*** Move to: ${key}\n*** End Patch` }), RUNNER_KEY_PATH_DENY)
  // bash 의 workdir(명령이 도는 폴더)로 키 저장소에 들어가 상대 경로로 읽는 우회도 막는다.
  assert.equal(oc('bash', { command: 'cat keys/kodi', workdir: '/Users/x/.genia-works' }), RUNNER_KEY_PATH_DENY)
  assert.equal(oc('bash', { command: 'cat kodi', workdir: '~/.genia-works/keys' }), RUNNER_KEY_PATH_DENY)
  // 홈에서 상대 경로로 여는 것은 명령에서 잡힌다.
  assert.equal(oc('bash', { command: 'cat .genia-works/keys/kodi', workdir: '/Users/x' }), RUNNER_KEY_PATH_DENY)
  // 쓰는 내용에 키 저장소가 언급된 것은 막지 않는다.
  assert.equal(oc('write', { filePath: '/r/README.md', content: '키는 ~/.genia-works 에 둔다' }), undefined)
  assert.equal(oc('edit', { filePath: '/r/a.md', oldString: 'a', newString: '~/.genia-works/keys' }), undefined)
  assert.equal(oc('apply_patch', { patchText: '*** Begin Patch\n*** Update File: /r/a.md\n@@\n+~/.genia-works/keys 설명\n*** End Patch' }), undefined)
  assert.equal(oc('bash', { command: 'git status', workdir: '/r' }), undefined)
})

test('toolBlockReason: 막힘 문구는 실행기에 맞춘다 — genia 는 /gw-as, OpenCode·Codex 는 없는 명령을 안내하지 않는다', () => {
  const key = '/Users/x/.genia-works/keys/kodi'
  // genia(실행기를 주지 않거나 genia)는 그대로.
  assert.equal(toolBlockReason('bash', { command: `cat ${key}` }), GENIA_KEY_PATH_DENY)
  assert.equal(toolBlockReason('bash', { command: 'gw-headers' }), GENIA_HEADER_SCRIPT_DENY)
  assert.equal(toolBlockReason('bash', { command: `cat ${key}` }, { cli: 'genia' }), GENIA_KEY_PATH_DENY)
  for (const cli of ['opencode', 'codex']) {
    assert.equal(toolBlockReason('bash', { command: `cat ${key}` }, { cli }), RUNNER_KEY_PATH_DENY, cli)
    assert.equal(toolBlockReason('bash', { command: 'gw-headers' }, { cli }), RUNNER_HEADER_SCRIPT_DENY, cli)
  }
  for (const m of [RUNNER_KEY_PATH_DENY, RUNNER_HEADER_SCRIPT_DENY]) {
    assert.ok(!/\/gw-as|\/genia-works:as/.test(m), m)
    assert.ok(m.includes('genia-works'), m)
  }
  // workdir 은 OpenCode 에서만 본다(genia·Codex 판정은 그대로).
  assert.equal(toolBlockReason('bash', { command: 'cat keys/kodi', workdir: '/Users/x/.genia-works' }), undefined)
  assert.equal(toolBlockReason('bash', { command: 'cat keys/kodi', workdir: '/Users/x/.genia-works' }, { cli: 'codex' }), undefined)
})

test('guardHooks: shell.env 는 토큰 변수를 빈 값으로 덮고, tool.execute.before 는 막을 호출에서 이유를 담아 throw 한다', async () => {
  const h = guardHooks()
  const out = { env: { KEEP: '1' } }
  await h['shell.env']({}, out)
  assert.deepEqual(out.env, { KEEP: '1', [TOKEN_ENV]: '', GENIA_WORKS_TOKEN: '' })
  await assert.rejects(h['tool.execute.before']({ tool: 'read' }, { args: { filePath: '/u/.genia-works/keys/a' } }), { message: RUNNER_KEY_PATH_DENY })
  await assert.rejects(h['tool.execute.before']({ tool: 'bash' }, { args: { command: 'gw-headers' } }), { message: RUNNER_HEADER_SCRIPT_DENY })
  await assert.rejects(h['tool.execute.before']({ tool: 'bash' }, { args: { command: 'cat keys/a', workdir: '/u/.genia-works' } }), { message: RUNNER_KEY_PATH_DENY })
  await h['tool.execute.before']({ tool: 'bash' }, { args: { command: 'ls' } })
  await h['tool.execute.before']({ tool: 'bash' }, {})
})

test('guard-plugin.js: OpenCode 가 부를 함수 하나만 내고, 그 함수가 두 훅을 돌려준다', async () => {
  const mod = await import(pathToFileURL(join(root, 'opencode', 'guard-plugin.js')).href)
  assert.deepEqual(Object.keys(mod), ['GeniaWorksGuard'])
  const hooks = await mod.GeniaWorksGuard({})
  assert.deepEqual(Object.keys(hooks).sort(), ['shell.env', 'tool.execute.before'])
})

/**
 * 가짜 opencode 로 gw-opencode-loop 를 띄워 회차를 돌리고, until(out) 이 참이 될 때까지 기다린 뒤 끝낸다.
 * until 이 없으면 구동기가 스스로 끝나기를 기다린다. 첫 회차는 다음 확인 시각(과거 → 60초 뒤로 자름) 대신 바로 none 을 내게 할 수 있다.
 * 돌려주는 값: { calls(가짜가 받은 것), out(구동기 출력), err }.
 */
async function runOpencodeLoop({ as, until: done, firstNone = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'gw-opencode-test-'))
  const home = join(dir, 'home')
  mkdirSync(home)
  const env = { PATH: process.env.PATH, HOME: home }
  // 가짜 AI 키 — 32자가 넘지 않게(키 모양 검사에 걸리지 않게) 짧은 값.
  assert.equal(spawnSync(join(root, 'scripts', 'gw-keys'), ['add', 'kodi'], { input: 'ak_FAKE_OPENC_1\n', env }).status, 0)
  const fake = join(dir, 'opencode')
  const record = join(dir, 'record.json')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs = require('node:fs')
const argv = process.argv.slice(2)
const prev = fs.existsSync(${JSON.stringify(record)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(record)}, 'utf8')) : []
// stdin 이 파이프면 진짜 opencode 는 시작하지 않는다 — 구동기가 닫아(ignore → /dev/null) 넘기는지 본다.
const st = fs.fstatSync(0)
prev.push({ argv, token: process.env.${TOKEN_ENV}, wakes: process.env.GENIA_WORKS_RUNNER_WAKES, mode: process.env.GENIA_WORKS_WAKE_MODE, mine: process.env.GENIA_WORKS_TOKEN ?? null, config: process.env.OPENCODE_CONFIG_CONTENT, stdinPipe: st.isFIFO() || st.isSocket() })
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(prev))
const n = prev.length
const sid = 'ses_' + n
const out = (o) => console.log(JSON.stringify({ sessionID: sid, ...o }))
out({ type: 'step_start', part: {} })
console.log('malformed JSON')
out({ type: 'tool_use', part: { tool: 'bash', state: { status: 'completed', input: { command: 'git status token=TOKEN_PRIVATE' }, output: 'OUTPUT_PRIVATE' } } })
out({ type: 'tool_use', part: { tool: 'genia-works_list_issues', state: { status: 'completed', input: { value: 'ARGS_PRIVATE' }, output: 'RESULT_PRIVATE' } } })
out({ type: 'text', part: { text: '조사 중' } })
out({ type: 'step_finish', part: { reason: 'tool-calls' } })
out({ type: 'step_start', part: {} })
const last = process.env.GW_TEST_FIRST_NONE === '1' || n > 1 ? '끝\\nGW-NEXT-CHECK none' : '첫 답\\nGW-NEXT-CHECK 2020-01-01T00:00:00Z'
out({ type: 'text', part: { text: last } })
out({ type: 'step_finish', part: { reason: 'stop' } })
console.error('opencode stderr line')
`,
  )
  chmodSync(fake, 0o755)
  // 알림 감시는 가짜 HOME 이라 AI 키 신원으로 붙지 못해 곧 끝난다 — 이 테스트는 부르기와 none 확인만 본다.
  // GENIA_AGENT_GENERATION 이 없어 gw-status 는 서버에 묻지 않고 RUN 을 낸다(Works 밖).
  const p = spawn(join(root, 'scripts', 'gw-opencode-loop'), ['WP', '--queue', '"AI 개발팀"'], {
    env: {
      ...env,
      GENIA_WORKS_AS: as,
      GW_OPENCODE: fake,
      GW_TEST_FIRST_NONE: firstNone ? '1' : '0',
      GENIA_WORKS_TOKEN: 'swp_MINE',
      GENIA_WORKS_TENANT: '7',
      GENIA_WORKS_MCP_URL: 'http://127.0.0.1:9/mcp',
      GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  p.stderr.on('data', (d) => (err += d))
  p.stdout.on('data', (d) => (out += d))
  const closed = new Promise((r) => p.on('close', r))
  if (done) {
    for (let i = 0; i < 150 && !done(out); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 300))
    p.kill('SIGTERM')
  }
  await closed
  assert.ok(existsSync(record), out)
  return { calls: JSON.parse(readFileSync(record, 'utf8')), out, err }
}

test('gw-opencode-loop: 세션을 이어 부르고, 진행 요약·마지막 답만 내며, none 에서 상태가 RUN 이면 20분 뒤 재확인한다(키는 opencode 환경에만)', async () => {
  const { calls, out, err } = await runOpencodeLoop({ as: 'kodi', until: (o) => o.includes('20분 뒤 다시 봅니다') })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].token, 'ak_FAKE_OPENC_1')
  assert.equal(calls[0].wakes, '1')
  assert.equal(calls[0].mode, 'runner')
  assert.equal(calls[0].mine, null) // 내 토큰은 넘기지 않는다
  assert.equal(calls[0].stdinPipe, false) // 구동기의 stdin 이 파이프여도 opencode 에는 닫아 넘긴다
  assert.ok(!calls[0].argv.some((a) => a.includes('ak_FAKE_OPENC_1')))
  const cfg = JSON.parse(calls[0].config)
  assert.ok(!calls[0].config.includes('ak_FAKE_OPENC_1')) // 설정 내용(셸 도구도 물려받는다)에 키를 넣지 않는다
  assert.equal(cfg.mcp['genia-works'].url, 'http://127.0.0.1:9/mcp')
  assert.equal(cfg.mcp['genia-works'].headers['X-On-Behalf-Of-Tenant'], '7')
  assert.deepEqual(cfg.plugin, [pathToFileURL(join(root, 'opencode', 'guard-plugin.js')).href])
  assert.deepEqual(calls[0].argv.slice(0, 3), ['run', '--format', 'json'])
  assert.ok(!calls[0].argv.includes('-s'))
  assert.ok(calls[0].argv.at(-1).includes('인자: WP --queue "AI 개발팀"'))
  assert.deepEqual(calls[1].argv.slice(3, 5), ['-s', 'ses_1'])
  assert.ok(out.includes('OpenCode 회차 시작 — 진행 상황을 기다립니다'))
  assert.ok(out.includes('work-loop 부름(세션 ses_1 이어서)'))
  assert.ok(out.includes('명령 실행: git status token=[REDACTED]'))
  assert.ok(out.includes('도구 호출: genia-works_list_issues'))
  assert.ok(out.includes('답변: 조사 중'))
  for (const forbidden of ['TOKEN_PRIVATE', 'OUTPUT_PRIVATE', 'ARGS_PRIVATE', 'RESULT_PRIVATE', 'malformed JSON', '"type"', 'ak_FAKE_OPENC_1']) assert.ok(!out.includes(forbidden), out)
  // 마지막 답은 마지막 단계의 글만 — 중간 단계 글(조사 중)은 답으로 붙지 않는다.
  assert.ok(out.includes('\n첫 답\nGW-NEXT-CHECK 2020-01-01T00:00:00Z\n'), out)
  assert.ok(out.includes('다음 확인 60초 뒤'))
  assert.ok(out.includes('GW-NEXT-CHECK none 이지만 상태가 RUN 이라 20분 뒤 다시 봅니다'), out)
  assert.ok(err.includes('opencode stderr line'))
})

// 구동기가 스스로 끝나기를 기다리므로, 멈추지 않는 회귀면 매달리지 않고 30초 안에 실패하게 시간 제한을 둔다.
test('gw-opencode-loop: AI 키 신원이 아니면 GW-NEXT-CHECK none 에서 멈춘다', { timeout: 30_000 }, async () => {
  const { calls, out } = await runOpencodeLoop({ as: 'nobody', firstNone: true, until: (o) => o.includes('AI 키 신원이 아님') })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].token, '')
  assert.ok(out.includes('다음 확인을 잡지 않습니다(GW-NEXT-CHECK none, AI 키 신원이 아님)'), out)
})
