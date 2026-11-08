// Codex 구동기·키 보호 hook 테스트(WP-1295) — 진짜 codex 없이 가짜 codex(GW_CODEX)로 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { progressSummaryFrom, codexArgs, threadIdFrom, guardDecision, tomlString, TOKEN_ENV } from '../codex/lib.mjs'
import { workLoopPrompt } from '../genia/loop.js'
import { RUNNER_HEADER_SCRIPT_DENY, RUNNER_KEY_PATH_DENY } from '../genia/loop.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

test('codexArgs: 처음은 exec, 대화가 있으면 exec resume <대화>, MCP·토큰 변수·셸 환경 제외·hook·무승인을 -c 로 넘긴다', () => {
  const base = { outFile: '/t/last.txt', mcpUrl: 'https://w/mcp', tenant: '7', guardCommand: "node '/p/codex/guard.mjs'", prompt: 'P' }
  const first = codexArgs({ ...base, thread: undefined })
  assert.deepEqual(first.slice(0, 4), ['exec', '--json', '-o', '/t/last.txt'])
  assert.equal(first.at(-1), 'P')
  assert.ok(first.includes('--dangerously-bypass-approvals-and-sandbox'))
  assert.ok(first.includes('--dangerously-bypass-hook-trust'))
  assert.ok(first.includes('mcp_servers.genia-works.url="https://w/mcp"'))
  assert.ok(first.includes(`mcp_servers.genia-works.bearer_token_env_var="${TOKEN_ENV}"`))
  assert.ok(first.includes('mcp_servers.genia-works.http_headers={ "User-Agent" = "codex/genia-works-0", "X-On-Behalf-Of-Tenant" = "7" }'))
  assert.ok(first.includes(`shell_environment_policy.exclude=["${TOKEN_ENV}", "GENIA_WORKS_TOKEN"]`))
  assert.ok(first.includes(`hooks.PreToolUse=[{ matcher = "*", hooks = [{ type = "command", command = "node '/p/codex/guard.mjs'" }] }]`))
  const again = codexArgs({ ...base, thread: 'T1', tenant: '7; x', version: '0.1.34' })
  assert.deepEqual(again.slice(0, 2), ['exec', 'resume'])
  assert.deepEqual(again.slice(-2), ['T1', 'P'])
  // 숫자가 아닌 워크스페이스는 붙이지 않는다.
  assert.ok(again.includes('mcp_servers.genia-works.http_headers={ "User-Agent" = "codex/genia-works-0.1.34" }'))
  assert.equal(tomlString('a"b\\c'), '"a\\"b\\\\c"')
})

test('threadIdFrom·workLoopPrompt: thread.started 의 id 를 읽고, 프롬프트는 스킬 파일과 그 폴더·인자를 가리킨다', () => {
  assert.equal(threadIdFrom('경고\n{"type":"thread.started","thread_id":"T9"}\n{"type":"turn.started"}'), 'T9')
  assert.equal(threadIdFrom('{"type":"turn.started"}'), undefined)
  const p = workLoopPrompt({ skillsDir: '/p/skills', args: 'WP --queue "AI 개발팀"' })
  assert.ok(p.includes('/p/skills/work-loop/SKILL.md'))
  assert.ok(p.includes('이 스킬 폴더는 /p/skills/work-loop 이다'))
  assert.ok(p.includes('인자: WP --queue "AI 개발팀"'))
})

// 이벤트 분기 누락·금지 필드 노출·민감값 제거 회귀를 실제 요약 함수로 잡는다.
const summary = (type, item) => progressSummaryFrom(JSON.stringify({ type, item }))

test('진행 요약: 명령·MCP·답변·할 일의 허용된 필드만 출력한다', () => {
  assert.equal(summary('item.started', { type: 'command_execution', command: 'git status', aggregated_output: 'OUTPUT_PRIVATE' }), '명령 실행: git status')
  assert.equal(summary('item.started', { type: 'mcp_tool_call', server: 'works', tool: 'issue_get', arguments: { token: 'ARGS_PRIVATE' }, result: 'RESULT_PRIVATE' }), 'MCP 호출: works/issue_get')
  assert.equal(summary('item.completed', { type: 'agent_message', text: '진행 중\n다음 작업' }), '답변: 진행 중 다음 작업')
  for (const type of ['item.updated', 'item.completed']) {
    assert.equal(summary(type, { type: 'todo_list', items: [{ text: 'PRIVATE_TODO', completed: true }, { text: '비공개', completed: false }] }), '할 일: 1/2 완료')
  }
  assert.equal(summary('item.updated', { type: 'todo_list', items: [] }), '할 일: 0/0 완료')
})

test('진행 요약: 미지 이벤트·깨진 JSON·필수 필드 누락을 무시한다', () => {
  for (const line of ['not json', 'null', '[]', '{}', '{"type":"turn.started"}', '{"type":"item.started"}']) {
    assert.equal(progressSummaryFrom(line), undefined)
  }
  const invalid = [
    ['item.started', { type: 'unknown', command: 'ls' }],
    ['item.completed', { type: 'command_execution', command: 'ls' }],
    ['item.updated', { type: 'agent_message', text: 'text' }],
    ['item.started', { type: 'todo_list', items: [] }],
    ['item.started', { type: 'command_execution' }],
    ['item.started', { type: 'command_execution', command: 7 }],
    ['item.started', { type: 'command_execution', command: '  ' }],
    ['item.started', { type: 'mcp_tool_call', server: 's' }],
    ['item.started', { type: 'mcp_tool_call', server: 7, tool: 't' }],
    ['item.started', { type: 'mcp_tool_call', server: 's', tool: '' }],
    ['item.completed', { type: 'agent_message', text: null }],
    ['item.completed', { type: 'todo_list', items: {} }],
    ['item.updated', { type: 'todo_list', items: [null] }],
    ['item.updated', { type: 'todo_list', items: [{ text: 'x', completed: 'true' }] }],
  ]
  for (const [type, item] of invalid) assert.equal(summary(type, item), undefined)
})

test('진행 요약: 명령·답변의 비밀값을 먼저 제거하고 한 줄 120 코드 포인트 미리보기로 자른다', () => {
  const sensitive = `Bearer BEARER_PRIVATE token=TOKEN_PRIVATE api_key:"API_PRIVATE" password='PASS PRIVATE' secret = SECRET_PRIVATE ak_KEY_PRIVATE swp_KEY_PRIVATE`
  for (const [event, itemType, field, prefix] of [
    ['item.started', 'command_execution', 'command', '명령 실행: '],
    ['item.completed', 'agent_message', 'text', '답변: '],
  ]) {
    const cases = [
      sensitive,
      'Bearer BEARER_PRIVATE',
      'TOKEN=TOKEN_PRIVATE',
      'GENIA_WORKS_MCP_TOKEN=TOKEN_PRIVATE',
      '"api_key": "API_PRIVATE"',
      "password='PASS PRIVATE'",
      'secret = SECRET_PRIVATE',
      'ak_KEY_PRIVATE',
      'swp_KEY_PRIVATE',
      'password="PASS PRIVATE',
    ]
    for (const input of cases) {
      const result = summary(event, { type: itemType, [field]: input })
      assert.ok(result.includes('[REDACTED]'), result)
      for (const value of ['BEARER_PRIVATE', 'TOKEN_PRIVATE', 'API_PRIVATE', 'PASS PRIVATE', 'SECRET_PRIVATE', 'ak_KEY_PRIVATE', 'swp_KEY_PRIVATE']) assert.ok(!result.includes(value), result)
    }
    const long = summary(event, { type: itemType, [field]: '😀'.repeat(121) })
    assert.equal(long.slice(prefix.length), '😀'.repeat(120))
    assert.equal(summary(event, { type: itemType, [field]: '😀'.repeat(119) + ' token=TOKEN_PRIVATE' }).slice(prefix.length), '😀'.repeat(119) + ' ')
    assert.ok(!summary(event, { type: itemType, [field]: 'hello\r\nworld\t\u001b[31mred' }).includes('\u001b'))
  }
})

test('진행 요약: 역슬래시로 이스케이프한 따옴표 안의 비밀값을 명령·답변에서 제거한다', () => {
  const cases = [
    String.raw`password=\"PASS_PRIVATE\"`,
    String.raw`password=\"PASS PRIVATE\"`,
    String.raw`token=\'TOKEN_PRIVATE\'`,
    String.raw`api_key=\"API_PRIVATE`,
  ]
  for (const [event, itemType, field] of [
    ['item.started', 'command_execution', 'command'],
    ['item.completed', 'agent_message', 'text'],
  ]) {
    for (const input of cases) {
      const result = summary(event, { type: itemType, [field]: input })
      assert.ok(!/PASS_PRIVATE|PASS PRIVATE|TOKEN_PRIVATE|API_PRIVATE/.test(result), result)
      assert.ok(result.includes('[REDACTED]'), result)
    }
    assert.ok(summary(event, { type: itemType, [field]: String.raw`password=\"PASS_PRIVATE\" git status` }).endsWith('git status'))
  }
})

test('진행 요약: 이스케이프된 JSON 키의 비밀값을 명령·답변에서 제거한다', () => {
  const cases = [
    String.raw`curl -d \"{\\\"password\\\":\\\"PASS_PRIVATE\\\"}\"`,
    String.raw`curl -d "{\"password\":\"PASS_PRIVATE\"}"`,
  ]
  for (const [event, itemType, field] of [
    ['item.started', 'command_execution', 'command'],
    ['item.completed', 'agent_message', 'text'],
  ]) {
    for (const input of cases) {
      const result = summary(event, { type: itemType, [field]: input })
      assert.ok(!result.includes('PASS_PRIVATE'), result)
      assert.ok(result.includes('[REDACTED]'), result)
    }
  }
})

test('guard: Codex PreToolUse 입력(Bash·apply_patch)에서 키 저장소·헤더 스크립트면 종료 2, 아니면 0', () => {
  const keyPath = '/Users/x/.genia-works/keys/kodi'
  assert.ok(guardDecision({ tool_name: 'Bash', tool_input: { command: `cat ${keyPath}` } }))
  assert.ok(guardDecision({ tool_name: 'Bash', tool_input: { command: '/p/scripts/gw-headers --authorization' } }))
  assert.equal(guardDecision({ tool_name: 'Bash', tool_input: { command: 'git status' } }), undefined)
  // Codex 에는 genia 명령(/gw-as)이 없다 — 실행기 무관한 문구로 막는다(WP-1410).
  assert.equal(guardDecision({ tool_name: 'Bash', tool_input: { command: `cat ${keyPath}` } }), RUNNER_KEY_PATH_DENY)
  assert.equal(guardDecision({ tool_name: 'Bash', tool_input: { command: 'gw-headers' } }), RUNNER_HEADER_SCRIPT_DENY)
  const run = (input) => spawnSync('node', [join(root, 'codex', 'guard.mjs')], { input, encoding: 'utf8' })
  const blocked = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `cat ${keyPath}` } }))
  assert.equal(blocked.status, 2)
  assert.ok(blocked.stderr.includes('키 저장소'))
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })).status, 0)
  assert.equal(run('깨진 입력').status, 0) // hook 오류로 모든 도구가 멈추지 않게
})

/**
 * 가짜 codex 로 gw-codex-loop 를 띄워 「GW-NEXT-CHECK none」 한 번을 받게 하고, until(out) 이 참이 될 때까지 기다린 뒤 끝낸다.
 * until 이 없으면 구동기가 스스로 끝나기를 기다린다(멈춘 구동기는 붙잡을 타이머·감시가 없다).
 * as — 칸 신원(GENIA_WORKS_AS). 키는 kodi 로만 등록한다. 돌려주는 값: { calls(가짜 codex 가 받은 것), out(구동기 출력) }.
 */
async function runCodexLoopNone({ as, until: done, firstNone = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'gw-codex-test-'))
  const home = join(dir, 'home')
  mkdirSync(home)
  const env = { PATH: process.env.PATH, HOME: home }
  // 가짜 AI 키 — 32자가 넘지 않게(키 모양 검사에 걸리지 않게) 짧은 값.
  assert.equal(spawnSync(join(root, 'scripts', 'gw-keys'), ['add', 'kodi'], { input: 'ak_FAKE_CODEX_1\n', env }).status, 0)
  const fake = join(dir, 'codex')
  const record = join(dir, 'record.json')
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs = require('node:fs')
const argv = process.argv.slice(2)
const o = argv[argv.indexOf('-o') + 1]
const prev = fs.existsSync(${JSON.stringify(record)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(record)}, 'utf8')) : []
prev.push({ argv, token: process.env.${TOKEN_ENV}, wakes: process.env.GENIA_WORKS_RUNNER_WAKES, mode: process.env.GENIA_WORKS_WAKE_MODE, mine: process.env.GENIA_WORKS_TOKEN ?? null })
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(prev))
fs.writeFileSync(o, process.env.GW_TEST_FIRST_NONE === '1' ? '끝\\nGW-NEXT-CHECK none\\n' : (prev.length === 1 ? '첫 답\\nGW-NEXT-CHECK 2020-01-01T00:00:00Z\\n' : '끝\\nGW-NEXT-CHECK none\\n'))
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'T1' }))
console.log('malformed JSON')
console.log(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'git status token=TOKEN_PRIVATE', aggregated_output: 'OUTPUT_PRIVATE' } }))
console.log(JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'works', tool: 'issue_get', arguments: { value: 'ARGS_PRIVATE' }, result: 'RESULT_PRIVATE' } }))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '조사 중' } }))
console.log(JSON.stringify({ type: 'item.updated', item: { type: 'todo_list', items: [{ text: 'TODO_PRIVATE', completed: true }] } }))
console.error('Reading prompt from stdin...')
`,
  )
  chmodSync(fake, 0o755)
  // 알림 감시는 가짜 HOME 이라 AI 키 신원으로 붙지 못해 곧 끝난다 — 이 테스트는 부르기와 none 확인만 본다.
  // GENIA_AGENT_GENERATION 이 없어 gw-status 는 서버에 묻지 않고 RUN 을 낸다(Works 밖).
  const p = spawn(join(root, 'scripts', 'gw-codex-loop'), ['WP', '--queue', '"AI 개발팀"'], {
    env: { ...env, GENIA_WORKS_AS: as, GW_CODEX: fake, GW_TEST_FIRST_NONE: firstNone ? '1' : '0', GENIA_WORKS_TOKEN: 'swp_MINE', GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' },
    stdio: ['ignore', 'pipe', 'pipe'],
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

test('gw-codex-loop: 진행 요약을 출력하면서 none 에서 상태가 RUN 이면 20분 뒤 재확인하고, 키는 codex 환경에만 둔다(WP-1423·1425)', async () => {
  const { calls, out, err } = await runCodexLoopNone({ as: 'kodi', until: (o) => o.includes('20분 뒤 다시 봅니다') })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].token, 'ak_FAKE_CODEX_1')
  assert.equal(calls[0].wakes, '1')
  // 깨우는 방식(WP-1427) — work-loop 의 gw-wake-mode 가 runner 로 읽는다.
  assert.equal(calls[0].mode, 'runner')
  assert.equal(calls[0].mine, null) // 내 토큰은 넘기지 않는다
  assert.ok(!calls[0].argv.some((a) => a.includes('ak_FAKE_CODEX_1')))
  assert.ok(calls[0].argv.at(-1).includes('인자: WP --queue \"AI 개발팀\"'))
  assert.ok(calls[1].argv.includes('resume'))
  assert.equal(calls[1].argv.at(-2), 'T1')
  assert.ok(out.includes('Codex 회차 시작 — 진행 상황을 기다립니다'))
  assert.ok(out.includes('명령 실행: git status token=[REDACTED]'))
  assert.ok(out.includes('MCP 호출: works/issue_get'))
  assert.ok(out.includes('답변: 조사 중'))
  assert.ok(out.includes('할 일: 1/1 완료'))
  for (const forbidden of ['TOKEN_PRIVATE', 'OUTPUT_PRIVATE', 'ARGS_PRIVATE', 'RESULT_PRIVATE', 'TODO_PRIVATE', 'malformed JSON', '\"type\"']) assert.ok(!out.includes(forbidden), out)
  assert.ok(out.includes('첫 답\nGW-NEXT-CHECK'))
  assert.ok(out.includes('끝\nGW-NEXT-CHECK none'))
  assert.ok(err.includes('Reading prompt from stdin...'))
  assert.ok(out.includes('GW-NEXT-CHECK none 이지만 상태가 RUN 이라 20분 뒤 다시 봅니다'), out)
  assert.ok(!out.includes('다음 확인을 잡지 않습니다'))
  assert.ok(!out.includes('ak_FAKE_CODEX_1'))
})

// 구동기가 스스로 끝나기를 기다리므로, 멈추지 않는 회귀면 매달리지 않고 30초 안에 실패하게 시간 제한을 둔다.
test('gw-codex-loop: AI 키 신원이 아니면 GW-NEXT-CHECK none 에서 멈춘다', { timeout: 30_000 }, async () => {
  const { calls, out } = await runCodexLoopNone({ as: 'nobody', firstNone: true, until: (o) => o.includes('AI 키 신원이 아님') })
  assert.equal(calls.length, 1)
  assert.ok(out.includes('다음 확인을 잡지 않습니다(GW-NEXT-CHECK none, AI 키 신원이 아님)'), out)
  assert.ok(!out.includes('ak_FAKE_CODEX_1'))
})
