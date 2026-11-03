// Codex 구동기·키 보호 hook 테스트(WP-1295) — 진짜 codex 없이 가짜 codex(GW_CODEX)로 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexArgs, threadIdFrom, workLoopPrompt, guardDecision, tomlString, TOKEN_ENV } from '../codex/lib.mjs'

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

test('guard: Codex PreToolUse 입력(Bash·apply_patch)에서 키 저장소·헤더 스크립트면 종료 2, 아니면 0', () => {
  const keyPath = '/Users/x/.genia-works/keys/kodi'
  assert.ok(guardDecision({ tool_name: 'Bash', tool_input: { command: `cat ${keyPath}` } }))
  assert.ok(guardDecision({ tool_name: 'Bash', tool_input: { command: '/p/scripts/gw-headers --authorization' } }))
  assert.equal(guardDecision({ tool_name: 'Bash', tool_input: { command: 'git status' } }), undefined)
  const run = (input) => spawnSync('node', [join(root, 'codex', 'guard.mjs')], { input, encoding: 'utf8' })
  const blocked = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `cat ${keyPath}` } }))
  assert.equal(blocked.status, 2)
  assert.ok(blocked.stderr.includes('키 저장소'))
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })).status, 0)
  assert.equal(run('깨진 입력').status, 0) // hook 오류로 모든 도구가 멈추지 않게
})

test('gw-codex-loop: 칸 신원의 키를 codex 의 환경 변수로만 넘기고(명령줄엔 없음), GW-NEXT-CHECK none 이면 더 부르지 않는다', async () => {
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
prev.push({ argv, token: process.env.${TOKEN_ENV}, wakes: process.env.GENIA_WORKS_RUNNER_WAKES, mine: process.env.GENIA_WORKS_TOKEN ?? null })
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(prev))
fs.writeFileSync(o, '끝\\nGW-NEXT-CHECK none\\n')
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'T1' }))
`,
  )
  chmodSync(fake, 0o755)
  // 알림 감시는 가짜 HOME 이라 AI 키 신원으로 붙지 못해 곧 끝난다 — 이 테스트는 부르기만 본다.
  const p = spawn(join(root, 'scripts', 'gw-codex-loop'), ['WP', '--queue', '"AI 개발팀"'], {
    env: { ...env, GENIA_WORKS_AS: 'kodi', GW_CODEX: fake, GENIA_WORKS_TOKEN: 'swp_MINE', GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  const until = async (f) => {
    for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 100))
  }
  await until(() => out.includes('GW-NEXT-CHECK none'))
  await new Promise((r) => setTimeout(r, 300))
  p.kill('SIGTERM')
  await new Promise((r) => p.on('close', r))
  assert.ok(existsSync(record), out)
  const calls = JSON.parse(readFileSync(record, 'utf8'))
  assert.equal(calls.length, 1) // none — 다시 부르지 않는다
  assert.equal(calls[0].token, 'ak_FAKE_CODEX_1')
  assert.equal(calls[0].wakes, '1')
  assert.equal(calls[0].mine, null) // 내 토큰은 넘기지 않는다
  assert.ok(!calls[0].argv.some((a) => a.includes('ak_FAKE_CODEX_1')))
  assert.ok(calls[0].argv.at(-1).includes('인자: WP --queue "AI 개발팀"'))
  assert.ok(out.includes('다음 확인을 잡지 않습니다'))
})
