// genia-works mod 테스트 — claude plugin test 로 돈다. process.run·command.run(mcp)·ui 를 가로채 동작만 본다.
import { expect, mock, test } from 'claude-code/testing'

// 플러그인 명령 이름 — 판정 8 A안(명령 파일 commands/*.md, 플러그인 접두사 포함·슬래시 없음)
const AS_COMMAND = 'genia-works:as'
const LOGOUT_COMMAND = 'genia-works:logout'

// 스크립트 호출 기록과 가짜 응답
function stubScripts(on: any, answers: Record<string, { exitCode: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = []
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    calls.push(argv)
    const key = argv.slice(0, 2).map((a, i) => (i === 0 ? a.split('/').pop() : a)).join(' ')
    const a = answers[key] ?? { exitCode: 0, stdout: '' }
    return { value: { exitCode: a.exitCode, stdout: a.stdout ?? '', stderr: a.stderr ?? '' } }
  })
  return calls
}

test('as <이름>: 선택 저장 후 다시 연결을 요청하고 결과를 알린다', async ($, on) => {
  const calls = stubScripts(on, { 'gw-session select': { exitCode: 0 }, 'gw-session show': { exitCode: 0, stdout: 'ai-dev\n' } })
  const clock = mock.clock(on)
  const reconnects: string[] = []
  on('command.run', { command: 'mcp' }, (_$: any, e: any) => { reconnects.push(e.args); return {} })
  const r = await $.command.run({ command: AS_COMMAND, args: 'ai-dev' })
  expect(r.text).toContain('ai-dev')
  expect(calls.some((c) => c[1] === 'select' && c[2] === 'ai-dev')).toBe(true)
  await clock.advance(400)
  expect(reconnects).toEqual(['reconnect plugin:genia-works:genia-works'])
})

test('as <키 없는 이름>: 저장하지 않고 다시 연결하지 않는다', async ($, on) => {
  stubScripts(on, { 'gw-session select': { exitCode: 4, stderr: 'nobody 키가 없습니다' } })
  const clock = mock.clock(on)
  const reconnects: string[] = []
  on('command.run', { command: 'mcp' }, (_$: any, e: any) => { reconnects.push(e.args); return {} })
  const r = await $.command.run({ command: AS_COMMAND, args: 'nobody' })
  expect(r.text).toContain('키가 없습니다')
  await clock.advance(400)
  expect(reconnects).toEqual([])
})

test('logout: 내 토큰(select me)으로 돌리고 다시 연결 — clear 는 쓰지 않는다', async ($, on) => {
  const calls = stubScripts(on, { 'gw-session select': { exitCode: 0 } })
  on('command.run', { command: 'mcp' }, () => ({}))
  const r = await $.command.run({ command: LOGOUT_COMMAND, args: '' })
  expect(r.text).toContain('내 토큰')
  expect(calls.some((c) => c[1] === 'select' && c[2] === 'me')).toBe(true)
  expect(calls.some((c) => c[1] === 'clear')).toBe(false)
})

test('session.end: 종료면 선택을 지우고 /clear 면 두지 않는다', async ($, on) => {
  const calls = stubScripts(on, {})
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(calls.filter((c) => c[1] === 'clear').length).toBe(0)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } })
  expect(calls.filter((c) => c[1] === 'clear').length).toBe(1)
})

test('키 저장소를 읽는 도구 호출은 거부', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  const denied = await $.tool.call({ tool: 'Bash', command: 'cat ~/.genia-works/keys/ai-dev' })
  expect(denied.deny).toBeTruthy()
  const ok = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ok.result).toBe('ran')
})

test('세션 시작: 고른 이름의 키가 없으면 상태 줄이 직접 알린다', async ($, on) => {
  stubScripts(on, { 'gw-session show': { exitCode: 0, stdout: 'ghost\n' }, 'gw-keys has': { exitCode: 1 } })
  const clock = mock.clock(on)
  mock.env(on, {})
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  const statuses: string[] = []
  on('ui.status', (_$: any, e: any) => { statuses.push(JSON.stringify(e)); return { value: undefined } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(10) // 상태 줄 갱신은 시작을 막지 않게 타이머로 미뤄진다
  expect(statuses.join('|')).toContain('ghost 키가 없습니다 — /genia-works:login')
})

test('키 저장소 가드: Read·Grep·Bash 경로 변형은 거부', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  expect((await $.tool.call({ tool: 'Read', file_path: '/Users/x/.genia-works/keys/a' } as any)).deny).toBeTruthy()
  expect((await $.tool.call({ tool: 'Grep', path: '~/.genia-works', pattern: 'ak_' } as any)).deny).toBeTruthy()
  expect((await $.tool.call({ tool: 'Bash', command: 'cat $HOME/.genia-works/keys/a' } as any)).deny).toBeTruthy()
})

test('키 저장소 가드: 내용에 경로가 언급된 Edit 은 허용', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'a', new_string: '~/.genia-works/keys 는 보호' } as any)
  expect(r.result).toBe('ran')
})

test('as 인자 없음: 현재 신원과 등록된 이름을 알린다', async ($, on) => {
  stubScripts(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\nai-rev\t10-12\n' }, 'gw-session show': { exitCode: 0, stdout: 'ai-dev\n' } })
  mock.env(on, {})
  const r = await $.command.run({ command: AS_COMMAND, args: '' })
  expect(r.text).toContain('현재: ai-dev')
  expect(r.text).toContain('ai-dev, ai-rev')
})

test('as 인자 없음: 선택이 없으면 GENIA_WORKS_AS 를, me 면 내 토큰 문구를 보인다(상태 줄과 같은 규칙)', async ($, on) => {
  stubScripts(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  mock.env(on, { GENIA_WORKS_AS: 'ai-dev' })
  expect((await $.command.run({ command: AS_COMMAND, args: '' })).text).toContain('현재: ai-dev')
})

test('as 인자 없음: me 선택은 날 것 me 가 아니라 내 토큰 문구, 토큰이 없으면 설정 안내', async ($, on) => {
  stubScripts(on, { 'gw-keys list': { exitCode: 0, stdout: '' }, 'gw-session show': { exitCode: 0, stdout: 'me\n' } })
  mock.env(on, { GENIA_WORKS_AS: 'ai-dev' })
  const r = await $.command.run({ command: AS_COMMAND, args: '' })
  expect(r.text).toContain('현재: 내 토큰 없음 — /plugin configure genia-works@genia-works')
  expect(r.text).not.toContain('현재: me')
})

test('as me: 내 토큰으로 전환', async ($, on) => {
  const calls = stubScripts(on, {})
  const clock = mock.clock(on)
  on('command.run', { command: 'mcp' }, () => ({}))
  const r = await $.command.run({ command: AS_COMMAND, args: 'me' })
  expect(r.text).toContain('내 토큰')
  expect(calls.some((c) => c[1] === 'select' && c[2] === 'me')).toBe(true)
  await clock.advance(400)
})

test('logout: 시간이 지나면 다시 연결하고 상태 줄을 갱신한다', async ($, on) => {
  stubScripts(on, { 'gw-session show': { exitCode: 0, stdout: '' } })
  mock.env(on, {})
  const clock = mock.clock(on)
  const reconnects: string[] = []
  const statuses: string[] = []
  on('command.run', { command: 'mcp' }, (_$: any, e: any) => { reconnects.push(e.args); return {} })
  on('ui.status', (_$: any, e: any) => { statuses.push(JSON.stringify(e)); return { value: undefined } })
  await $.command.run({ command: LOGOUT_COMMAND, args: '' })
  expect(reconnects).toEqual([])
  await clock.advance(400)
  expect(reconnects).toEqual(['reconnect plugin:genia-works:genia-works'])
  expect(statuses.join('|')).toContain('내 토큰')
})

test('session.end: logout 사유도 선택을 지운다', async ($, on) => {
  const calls = stubScripts(on, {})
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  await $.session.end({ reason: 'logout', sessionId: 's', resume: { id: 's' } })
  expect(calls.filter((c) => c[1] === 'clear').length).toBe(1)
})

// ---- 로그인 패널 ----
const LOGIN_COMMAND = 'genia-works:login'
const PANE_ID = 'genia-works-login'
const SERVER_URL = 'http://127.0.0.1:1/mcp'
const FAKE_KEY = 'ak_FAKE_ABC'
const PANE_PROPS = { title: 'genia-works 로그인', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} } as const

// 패널 테스트용 가짜 세계 — 스크립트(stdin 기록)·http.fetch·ui 바닥 이벤트. 서버는 절대 부르지 않는다.
function loginWorld(on: any, answers: Record<string, { exitCode: number; stdout?: string; stderr?: string }>, fetchStatus: number | 'error' | 'hang' | 'slow' = 200, env: Record<string, string> = {}) {
  const runs: { argv: string[]; stdin?: string }[] = []
  const fetches: { url: string; init: any }[] = []
  const shown: string[] = [] // 화면 밖으로 나간 문구(로그·토스트·상태 줄)
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    runs.push({ argv, stdin: e.init?.stdin })
    const key = argv.slice(0, 2).map((a, i) => (i === 0 ? a.split('/').pop() : a)).join(' ')
    const a = answers[key] ?? { exitCode: 0, stdout: '' }
    return { value: { exitCode: a.exitCode, stdout: a.stdout ?? '', stderr: a.stderr ?? '' } }
  })
  on('http.fetch', (_$: any, e: any) => {
    fetches.push({ url: e.url, init: e.init })
    if (fetchStatus === 'slow') return new Promise((res) => setTimeout(() => res({ value: { status: 200, ok: true, headers: {}, text: '' } }), 30)) // 곧 성공하지만 늦게 도착
    if (fetchStatus === 'hang') return new Promise(() => {}) // 끝내 응답하지 않음
    if (fetchStatus === 'error') throw new Error('connect ECONNREFUSED')
    return { value: { status: fetchStatus, ok: (fetchStatus as number) >= 200 && (fetchStatus as number) < 300, headers: {}, text: '' } }
  })
  on('ui.open', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.toast', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.status', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  mock.env(on, env)
  const clock = mock.clock(on)
  return { clock, runs, fetches, shown, scripts: () => runs.map((r) => r.argv.slice(1).join(' ')) }
}

const mountPane = ($: any) => $.ui.mount({ plugin: 'genia-works', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE_PROPS })

test('login: 등록된 AI 가 없으면 새 AI 추가 화면을 연다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: '' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'gw-key' })).toBeTruthy()
  expect(await ui.find({ key: 'gw-name' })).toBeTruthy()
  await ui.unmount()
})

test('login: 새 AI 를 가림 입력·키 확인 후 저장하고 키가 어디에도 새지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: '' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  expect((await ui.find({ key: 'gw-key' }))?.text).toBe('●'.repeat(FAKE_KEY.length))
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  // 키 확인: opts.server_url 로 POST, Bearer 키
  expect(w.fetches.length).toBe(1)
  expect(w.fetches[0].url).toBe(SERVER_URL)
  expect(w.fetches[0].init.method).toBe('POST')
  expect(w.fetches[0].init.headers.Authorization).toBe('Bearer ' + FAKE_KEY)
  // 저장: gw-keys add ai-dev 가 stdin 으로만 키를 받는다
  const add = w.runs.find((r) => r.argv[0].endsWith('/gw-keys') && r.argv[1] === 'add')
  expect(add?.argv.slice(1)).toEqual(['add', 'ai-dev'])
  expect(add?.stdin).toBe(FAKE_KEY + '\n')
  expect(await ui.find({ key: 'gw-switch-now' })).toBeTruthy()
  // 키는 stdin 외 어디에도 없다 — argv·로그·토스트·상태 줄·화면 텍스트
  expect(w.runs.filter((r) => r !== add).map((r) => JSON.stringify(r)).join('|')).not.toContain(FAKE_KEY)
  expect(JSON.stringify(add?.argv)).not.toContain(FAKE_KEY)
  expect(w.shown.join('|')).not.toContain(FAKE_KEY)
  expect(JSON.stringify(await ui.findAll({}))).not.toContain(FAKE_KEY)
  await ui.unmount()
  // 다시 열면 키 입력칸이 비어 있다(keyBuf 비움)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const again = await mountPane($)
  expect((await again.find({ key: 'gw-key' }))?.text ?? '').toBe('')
  await again.unmount()
})

test('login: 키 확인이 401 이면 저장하지 않고 안내한다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: '' }, 'gw-session show': { exitCode: 0, stdout: '' } }, 401)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.runs.some((r) => r.argv[1] === 'add')).toBe(false)
  expect(JSON.stringify(await ui.findAll({}))).toContain('키가 맞지 않습니다')
  await ui.unmount()
})

test('login: 등록된 AI 를 고르면 세션 선택을 저장한다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  on('command.run', { command: 'mcp' }, () => ({}))
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'gw-pick-ai-dev' })).toBeTruthy()
  await ui.press({ key: 'gw-pick-ai-dev' })
  expect(w.runs.some((r) => r.argv[1] === 'select' && r.argv[2] === 'ai-dev')).toBe(true)
  await ui.unmount()
})

test('login: 관리 › 삭제 — 지금 쓰는 이름이면 세션 선택을 먼저 지우고 키를 지운다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: 'ai-dev\n' } })
  on('command.run', { command: 'mcp' }, () => ({}))
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' })
  await ui.press({ key: 'gw-remove-ai-dev' })
  expect(await ui.find({ key: 'gw-remove-confirm-ai-dev' })).toBeTruthy()
  await ui.press({ key: 'gw-remove-confirm-ai-dev' })
  const order = w.runs.map((r) => r.argv[1]).filter((a) => a === 'select' || a === 'remove')
  expect(order).toEqual(['select', 'remove'])
  expect(w.runs.find((r) => r.argv[1] === 'select')?.argv[2]).toBe('me')
  expect(w.runs.find((r) => r.argv[1] === 'remove')?.argv[2]).toBe('ai-dev')
  await ui.unmount()
})

// 키 입력 후 저장까지 한 번에 — 반환은 패널
async function fillAndSave($: any, key: string, name: string) {
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.input({ key: 'gw-key', text: key, kind: 'change' })
  await ui.input({ key: 'gw-name', text: name, kind: 'change' })
  await ui.input({ key: 'gw-name', text: name, kind: 'submit' })
  return ui
}
const EMPTY = { 'gw-keys list': { exitCode: 0, stdout: '' }, 'gw-session show': { exitCode: 0, stdout: '' } }

test('login: 닫으면 입력해 둔 키를 비운다(다시 열 때 명령 없이도 빈 칸)', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, EMPTY)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  expect((await ui.find({ key: 'gw-key' }))?.text).toBe('●'.repeat(FAKE_KEY.length))
  await ui.press({ key: 'gw-cancel' }) // 패널 닫기 — keyBuf 를 비운다(사람이 Esc 로 닫는 경로는 엔진이 처리기를 불러 테스트로 못 낸다)
  await ui.unmount()
  const again = await mountPane($)
  expect((await again.find({ key: 'gw-key' }))?.text ?? '').toBe('')
  await again.unmount()
})

test('login: 네트워크 오류는 저장하지 않고 고정 문구로 알리며 키를 비운다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY, 'error')
  const ui = await fillAndSave($, FAKE_KEY, 'ai-dev')
  expect(w.runs.some((r) => r.argv[1] === 'add')).toBe(false)
  const all = JSON.stringify(await ui.findAll({}))
  expect(all).toContain('서버에 접속하지 못했습니다')
  expect(all).not.toContain('ECONNREFUSED')
  expect((await ui.find({ key: 'gw-key' }))?.text ?? '').toBe('')
  await ui.unmount()
})

test('login: 401 이 아닌 HTTP 오류도 저장하지 않고 키를 비운다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY, 500)
  const ui = await fillAndSave($, FAKE_KEY, 'ai-dev')
  expect(w.runs.some((r) => r.argv[1] === 'add')).toBe(false)
  expect(JSON.stringify(await ui.findAll({}))).toContain('HTTP 500')
  expect((await ui.find({ key: 'gw-key' }))?.text ?? '').toBe('')
  await ui.unmount()
})

test('login: swp_ 키는 설정 안내만 하고 서버를 부르지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY)
  const ui = await fillAndSave($, 'swp_FAKE_X', 'ai-dev')
  expect(w.fetches.length).toBe(0)
  expect(JSON.stringify(await ui.findAll({}))).toContain('swp_')
  await ui.unmount()
})

test('login: 형식이 틀린 키는 서버를 부르지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY)
  const ui = await fillAndSave($, 'ak_bad key"', 'ai-dev')
  expect(w.fetches.length).toBe(0)
  expect(w.runs.some((r) => r.argv[1] === 'add')).toBe(false)
  await ui.unmount()
})

test('login: 이미 있는 이름은 한 번 더 눌러야 덮어쓴다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-add' })
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.fetches.length).toBe(0)
  expect(JSON.stringify(await ui.findAll({}))).toContain('바꿀까요')
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.fetches.length).toBe(1)
  expect(w.runs.find((r) => r.argv[1] === 'add')?.stdin).toBe(FAKE_KEY + '\n')
  await ui.unmount()
})

test('login: 저장 뒤 바꾸기는 그 이름으로 세션을 고른다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY)
  on('command.run', { command: 'mcp' }, () => ({}))
  const ui = await fillAndSave($, FAKE_KEY, 'ai-dev')
  await ui.press({ key: 'gw-switch-now' })
  expect(w.runs.some((r) => r.argv[1] === 'select' && r.argv[2] === 'ai-dev')).toBe(true)
  await ui.unmount()
})

test('login: 현재 쓰지 않는 이름을 지울 때는 세션 선택을 지우지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\nai-rev\t10-12\n' }, 'gw-session show': { exitCode: 0, stdout: 'ai-dev\n' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' })
  await ui.press({ key: 'gw-remove-ai-rev' })
  await ui.press({ key: 'gw-remove-confirm-ai-rev' })
  expect(w.runs.some((r) => r.argv[1] === 'clear')).toBe(false)
  expect(w.runs.find((r) => r.argv[1] === 'remove')?.argv[2]).toBe('ai-rev')
  await ui.unmount()
})

test('login: 지우기 스크립트가 실패하면 실패를 알린다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-rev\t10-12\n' }, 'gw-session show': { exitCode: 0, stdout: '' }, 'gw-keys remove': { exitCode: 1, stderr: 'boom' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' })
  await ui.press({ key: 'gw-remove-ai-rev' })
  await ui.press({ key: 'gw-remove-confirm-ai-rev' })
  expect(JSON.stringify(await ui.findAll({}))).toContain('지우지 못했습니다')
  await ui.unmount()
})

test('login: 서버가 응답하지 않으면 10초 뒤 안내하고 저장하지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY, 'hang')
  const clock = w.clock
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  const sent = ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  await clock.advance(10_500)
  await sent
  expect(JSON.stringify(await ui.findAll({}))).toContain('서버 응답이 없습니다')
  expect(w.runs.some((r) => r.argv[1] === 'add')).toBe(false)
  await ui.unmount()
})

test('login: 서버 확인 중에 취소하면 늦게 와도 저장하지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, EMPTY, 'slow')
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  const sent = ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  for (let i = 0; i < 50 && w.fetches.length === 0; i++) await new Promise((r) => setTimeout(r, 2)) // 확인 요청이 나간 뒤에 취소
  expect(w.fetches.length).toBe(1)
  await ui.press({ key: 'gw-cancel' })
  await sent
  await new Promise((r) => setTimeout(r, 60))
  expect(w.runs.some((r) => r.argv[1] === 'add')).toBe(false)
  await ui.unmount()
})

// ---- 기존 수동 등록 정리 ----
const OLD_TOKEN = 'swp_FAKE_OLD'
const NEW_TOKEN = 'swp_FAKE_NEW'
const OLD_CONFIG = { type: 'http', url: SERVER_URL, headers: { Authorization: 'Bearer ' + OLD_TOKEN } }

// 정리 테스트용 가짜 세계 — ~/.claude.json(fs.read)·claude 명령(process.run)·mcp.connect/call·http.fetch·ui. 실제 claude 는 부르지 않는다.
function cleanupWorld(on: any, o: { claudeJson?: any; fetchStatus?: number; connect?: any; callError?: boolean; run?: (argv: string[]) => any } = {}) {
  const runs: string[][] = []
  const cwds: unknown[] = []
  const shown: string[] = []
  const calls: string[] = []
  const claudeJson = o.claudeJson ?? { mcpServers: { 'genia-works': OLD_CONFIG } }
  on('fs.read', (_$: any, e: any) => ({ value: String(e.path).endsWith('/.claude.json') ? JSON.stringify(claudeJson) : (() => { throw new Error('ENOENT') })() }))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', (_$: any, e: any) => {
    runs.push(e.argv)
    if (e.argv[0] === 'claude') cwds.push(e.init?.cwd)
    const custom = o.run?.(e.argv)
    return { value: custom ?? { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('http.fetch', () => ({ value: { status: o.fetchStatus ?? 200, ok: (o.fetchStatus ?? 200) < 300, headers: {}, text: '' } }))
  on('mcp.connect', (_$: any, e: any) => { calls.push('connect ' + e.server); return { value: o.connect ?? { isConnected: true, server: 'plugin:genia-works:genia-works' } } })
  on('mcp.call', (_$: any, e: any) => {
    calls.push('call ' + e.server + ' ' + e.tool)
    if (o.callError) throw new Error('boom')
    return { value: { content: [], isError: false } }
  })
  on('ui.log', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.toast', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.status', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  mock.env(on, { HOME: '/home/fake' })
  const clock = mock.clock(on)
  const start = async ($: any) => {
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(1600)
  }
  const removes = () => runs.filter((r) => r[0] === 'claude' && r[2] === 'remove')
  const adds = () => runs.filter((r) => r[0] === 'claude' && r[2] === 'add-json')
  return { start, clock, runs, cwds, shown, calls, removes, adds }
}

test('수동 등록 정리: 플러그인 토큰이 없으면 지우지 않고 안내한다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = cleanupWorld(on)
  await w.start($)
  expect(w.removes()).toEqual([])
  expect(w.shown.join('|')).toContain('설정에 내 토큰을 넣으면 정리합니다')
})

test('수동 등록 정리: 확인·연결·호출이 모두 되면 지우고 알린다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on)
  await w.start($)
  expect(w.removes()).toEqual([['claude', 'mcp', 'remove', 'genia-works', '-s', 'user']])
  expect(w.adds()).toEqual([])
  expect(w.cwds).toEqual(['/repo'])
  expect(w.calls).toEqual(['connect genia-works', 'call plugin:genia-works:genia-works list_projects'])
  expect(w.shown.join('|')).toContain('기존 genia-works 수동 등록(사용자 범위)을 지우고 플러그인 연결로 바꿨습니다')
})

test('수동 등록 정리: 호출이 실패하면 원래 설정으로 되살린다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { callError: true })
  await w.start($)
  expect(w.removes().length).toBe(1)
  expect(w.adds()).toEqual([['claude', 'mcp', 'add-json', 'genia-works', JSON.stringify(OLD_CONFIG), '-s', 'user']])
  expect(w.shown.join('|')).toContain('기존 등록을 되살렸습니다')
})

test('수동 등록 정리: 연결이 안 되면 되살리지 않고 다시 시작을 안내한다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { connect: { isConnected: false, reason: 'failed', message: 'x' } })
  await w.start($)
  expect(w.removes().length).toBe(1)
  expect(w.adds()).toEqual([])
  expect(w.shown.join('|')).toContain('다시 시작하면 플러그인 연결로 바뀝니다')
})

test('수동 등록 정리: 토큰 확인이 401 이면 지우지 않는다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { fetchStatus: 401 })
  await w.start($)
  expect(w.removes()).toEqual([])
  expect(w.shown.join('|')).toContain('기존 등록을 그대로 둡니다')
})

test('수동 등록 정리: claude 를 못 찾으면 연결하지 않고 터미널 명령을 안내한다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { run: (argv) => { if (argv[2] === 'remove') throw new Error('spawn claude ENOENT') } })
  await w.start($)
  expect(w.calls).toEqual([])
  expect(w.shown.join('|')).toContain('claude mcp remove genia-works -s user')
})

test('수동 등록 정리: connect 가 옛 수동 서버 이름으로 답하면 연결 안 됨으로 본다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { connect: { isConnected: true, server: 'genia-works' } })
  await w.start($)
  expect(w.removes().length).toBe(1)
  expect(w.adds()).toEqual([])
  expect(w.calls).toEqual(['connect genia-works'])
  expect(w.shown.join('|')).toContain('다시 시작하면 플러그인 연결로 바뀝니다')
})

test('수동 등록 정리: remove 가 0 이 아닌 코드로 끝나면 이름만 알리고 멈춘다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { run: (argv) => (argv[2] === 'remove' ? { exitCode: 1, stdout: '', stderr: 'secret-looking ' + OLD_TOKEN } : undefined) })
  await w.start($)
  expect(w.calls).toEqual([])
  const text = w.shown.join('|')
  expect(text).toContain('기존 등록 genia-works 을 지우지 못했습니다')
  expect(text).not.toContain(OLD_TOKEN)
})

test('수동 등록 정리: 두 번째 remove 가 실패하면 첫 번째를 되살린다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const local = { type: 'http', url: SERVER_URL + '/' }
  const w = cleanupWorld(on, {
    claudeJson: { mcpServers: { 'genia-works': OLD_CONFIG }, projects: { '/repo': { mcpServers: { gw: local } } } },
    run: (argv) => (argv[2] === 'remove' && argv[3] === 'gw' ? { exitCode: 1, stdout: '', stderr: 'x' } : undefined),
  })
  await w.start($)
  expect(w.adds()).toEqual([['claude', 'mcp', 'add-json', 'genia-works', JSON.stringify(OLD_CONFIG), '-s', 'user']])
  expect(w.cwds.every((c) => c === '/repo')).toBe(true)
  expect(w.calls).toEqual([])
})

test('수동 등록 정리: 되살리기도 실패하면 성공이라 하지 않는다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { callError: true, run: (argv) => (argv[2] === 'add-json' ? { exitCode: 1, stdout: '', stderr: 'x' } : undefined) })
  await w.start($)
  const text = w.shown.join('|')
  expect(text).toContain('기존 등록을 되살리지 못했습니다')
  expect(text).not.toContain('되살렸습니다')
})

for (const [label, o] of [['성공', {}], ['호출 실패', { callError: true }], ['연결 안 됨', { connect: { isConnected: false, reason: 'failed', message: 'x' } }], ['확인 401', { fetchStatus: 401 }], ['remove 실패', { run: (a: string[]) => (a[2] === 'remove' ? { exitCode: 1, stdout: '', stderr: 'x' } : undefined) }], ['claude 없음', { run: (a: string[]) => { if (a[2] === 'remove') throw new Error('ENOENT') } }]] as const) {
  test(`수동 등록 정리: 옛 토큰이 토스트·로그·상태 줄 어디에도 새지 않는다 (${label})`, { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
    const w = cleanupWorld(on, o as any)
    await w.start($)
    const text = w.shown.join('|')
    expect(text).not.toContain(OLD_TOKEN)
    expect(text).not.toContain(NEW_TOKEN)
  })
}

test('login: 같은 세션에서 다시 열면 다시 그리기를 요청하고 새 상태를 그린다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const answers = { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } }
  loginWorld(on, answers)
  const invalidated: string[] = []
  on('ui.invalidate', (_$: any, e: any) => { invalidated.push(e.event); return { value: undefined } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  expect(invalidated).toContain('ui.render') // 열 때마다 요청한다
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' }) // 상태를 지난 화면과 다르게 만든 뒤 닫는다
  await ui.unmount()
  invalidated.length = 0
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  expect(invalidated).toEqual(['ui.render'])
  const again = await mountPane($)
  expect(await again.find({ key: 'gw-pick-ai-dev' })).toBeTruthy() // 처음 화면(고르기)으로 되돌아와 있다
  await again.unmount()
})

test('login: 저장 뒤 화면은 바꾸기에 처음 포커스를 둔다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, EMPTY)
  const ui = await fillAndSave($, FAKE_KEY, 'ai-dev')
  const now: any = await ui.find({ key: 'gw-switch-now' })
  expect(JSON.stringify(now)).toContain('autoFocus')
  const later: any = await ui.find({ key: 'gw-later' })
  expect(JSON.stringify(later)).not.toContain('autoFocus')
  await ui.unmount()
})

test('비대화형(-p): as·logout·login 은 바꾸지 않고 안내만 한다', async ($, on) => {
  const calls = stubScripts(on, {})
  const clock = mock.clock(on)
  mock.env(on, {})
  const reconnects: string[] = []
  on('command.run', { command: 'mcp' }, (_$: any, e: any) => { reconnects.push(e.args); return {} })
  on('ui.open', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })
  const before = calls.length
  const as = await $.command.run({ command: AS_COMMAND, args: 'ai-dev' })
  expect(as.text).toContain('이 세션에서는 바꿀 수 없습니다')
  expect(as.text).toContain('GENIA_WORKS_AS')
  expect((await $.command.run({ command: LOGOUT_COMMAND, args: '' })).text).toContain('바꿀 수 없습니다')
  expect((await $.command.run({ command: LOGIN_COMMAND, args: '' })).text).toContain('대화형')
  await clock.advance(400)
  expect(calls.slice(before).some((c) => c[1] === 'select' || c[1] === 'clear')).toBe(false)
  expect(reconnects).toEqual([])
})

// ---- 최종 리뷰 반영 ----
test('헤더 스크립트 직접 실행은 거부, gw-set-key 와 README 편집은 허용', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  const p = '/Users/x/.claude/plugins/cache/genia-works/genia-works/0.1.0/scripts'
  for (const command of [`${p}/gw-headers`, `sh ${p}/gw-headers`, `${p}/gw-session-key`]) {
    const r: any = await $.tool.call({ tool: 'Bash', command } as any)
    expect(r.deny).toContain('헤더 스크립트는 직접 실행할 수 없습니다')
    expect(r.deny).toContain('/genia-works:as')
  }
  expect((await $.tool.call({ tool: 'Bash', command: `${p}/gw-set-key ai-dev` } as any)).result).toBe('ran')
  expect((await $.tool.call({ tool: 'Edit', file_path: '/repo/plugins/genia-works/README.md', old_string: 'a', new_string: 'gw-headers' } as any)).result).toBe('ran')
})

test('상태 줄: 내 토큰이 어디에도 없으면 설정 안내', async ($, on) => {
  stubScripts(on, { 'gw-session show': { exitCode: 0, stdout: '' } })
  const clock = mock.clock(on)
  mock.env(on, {})
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  const statuses: string[] = []
  on('ui.status', (_$: any, e: any) => { statuses.push(JSON.stringify(e)); return { value: undefined } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(10) // 상태 줄 갱신은 시작을 막지 않게 타이머로 미뤄진다
  expect(statuses.join('|')).toContain('내 토큰 없음 — /plugin configure genia-works@genia-works')
})

test('상태 줄: 플러그인 설정 토큰이 있으면 내 토큰', { options: { server_url: SERVER_URL, token: 'swp_FAKE_X' } }, async ($, on) => {
  stubScripts(on, { 'gw-session show': { exitCode: 0, stdout: '' } })
  const clock = mock.clock(on)
  mock.env(on, {})
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  const statuses: string[] = []
  on('ui.status', (_$: any, e: any) => { statuses.push(JSON.stringify(e)); return { value: undefined } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(10) // 상태 줄 갱신은 시작을 막지 않게 타이머로 미뤄진다
  expect(statuses.join('|')).toContain('내 토큰')
  expect(statuses.join('|')).not.toContain('없음')
})

test('login: GENIA_WORKS_TOKEN 이 있으면 내 토큰 버튼에 환경변수를 밝힌다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } }, 200, { GENIA_WORKS_TOKEN: 'swp_FAKE_ENV' })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  expect(JSON.stringify(await ui.find({ key: 'gw-pick-me' }))).toContain('내 토큰 (환경변수 GENIA_WORKS_TOKEN)')
  await ui.unmount()
})

test('login: 환경변수 토큰이 없으면 내 토큰 버튼은 그대로', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  expect(JSON.stringify(await ui.find({ key: 'gw-pick-me' }))).not.toContain('GENIA_WORKS_TOKEN')
  await ui.unmount()
})

const AI_CONFIG = { type: 'http', url: SERVER_URL, headers: { authorization: 'Bearer ak_FAKE_KEEP' } }

test('수동 등록 정리: AI 키(ak_) 등록은 지우지 않고 키 없이 안내, 나머지는 지운다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { claudeJson: { mcpServers: { 'ai-manual': AI_CONFIG, 'genia-works': OLD_CONFIG } } })
  await w.start($)
  expect(w.removes()).toEqual([['claude', 'mcp', 'remove', 'genia-works', '-s', 'user']])
  const text = w.shown.join('|')
  expect(text).toContain('기존 genia-works 등록(ai-manual)은 AI 키로 연결돼 있어 그대로 둡니다')
  expect(text).toContain('claude mcp remove ai-manual -s user')
  expect(text).not.toContain('ak_FAKE_KEEP')
  expect(text).not.toContain(OLD_TOKEN)
})

test('수동 등록 정리: AI 키 등록을 남기고 연결이 아직이면 「다시 시작하면 바뀝니다」를 약속하지 않는다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on, { claudeJson: { mcpServers: { 'ai-manual': AI_CONFIG, 'genia-works': OLD_CONFIG } }, connect: { isConnected: true, server: 'ai-manual' } })
  await w.start($)
  const text = w.shown.join('|')
  expect(text).toContain('남겨 둔 AI 키 등록(ai-manual)을 지운 뒤 다시 시작해야 플러그인 연결로 바뀝니다')
  expect(text).not.toContain('이 세션은 다시 시작하면 플러그인 연결로 바뀝니다')
  expect(text).not.toContain('ak_FAKE_KEEP')
})

test('수동 등록 정리: AI 키 등록뿐이면 아무것도 지우지 않는다(토큰이 없어도 안내는 AI 키 문구)', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = cleanupWorld(on, { claudeJson: { mcpServers: { 'ai-manual': AI_CONFIG } } })
  await w.start($)
  expect(w.removes()).toEqual([])
  expect(w.shown.join('|')).toContain('AI 키로 연결돼 있어 그대로 둡니다')
  expect(w.shown.join('|')).not.toContain('ak_FAKE_KEEP')
})

test('수동 등록 정리: 비대화형 세션에서는 건드리지 않는다', { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
  const w = cleanupWorld(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await w.clock.advance(1600)
  expect(w.calls).toEqual([])
  expect(w.removes()).toEqual([])
})

const HAS_AI_DEV = { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } }

test('login: 확인에 실패하면 덮어쓰기 확인도 풀려 다른 키는 다시 확인을 거친다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, HAS_AI_DEV, 500)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-add' })
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' }) // 첫 저장: 덮어쓸지 묻는다
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' }) // 두 번째: 서버 확인(500)에서 실패
  expect(w.fetches.length).toBe(1)
  await ui.input({ key: 'gw-key', text: 'ak_FAKE_OTHER', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' }) // 다른 키 — 다시 물어야 하고 서버도 부르지 않는다
  expect(w.fetches.length).toBe(1)
  expect(JSON.stringify(await ui.findAll({}))).toContain('바꿀까요')
  await ui.unmount()
})

test('login: 첫 저장 뒤 키나 이름을 고치면 덮어쓰기 확인이 풀린다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, HAS_AI_DEV)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-add' })
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' }) // 묻는다
  await ui.input({ key: 'gw-key', text: '●'.repeat(FAKE_KEY.length) + 'X', kind: 'change' }) // 키를 고침
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.fetches.length).toBe(0) // 다시 물었다
  await ui.input({ key: 'gw-name', text: 'ai-dev2', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' }) // 이름을 바꿨다 되돌려도 확인은 풀린다
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.fetches.length).toBe(0)
  await ui.unmount()
})

test('login: 관리 › 키 바꾸기는 이미 바꾸기로 골랐으므로 덮어쓰기를 다시 묻지 않는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, HAS_AI_DEV)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' })
  await ui.press({ key: 'gw-rekey-ai-dev' })
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.fetches.length).toBe(1)
  expect(w.runs.find((r) => r.argv[1] === 'add')?.argv[2]).toBe('ai-dev')
  await ui.unmount()
})

test('login: 키 바꾸기에서 이름을 다른 기존 이름으로 바꾸면 다시 묻는다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\nai-rev\t10-12\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' })
  await ui.press({ key: 'gw-rekey-ai-dev' })
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-rev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-rev', kind: 'submit' })
  expect(w.fetches.length).toBe(0)
  expect(JSON.stringify(await ui.findAll({}))).toContain('바꿀까요')
  await ui.unmount()
})

test('session.end: 정리 스크립트가 던져도 종료 흐름(next)은 이어진다', async ($, on) => {
  on('process.run', () => { throw new Error('spawn boom') })
  let reached = false
  on('session.end', (_$: any, e: any) => { reached = true; return { sessionId: e.sessionId } })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } })
  expect(reached).toBe(true)
})

// ---- 화면 전환과 포커스(결함 A·B) ----
// 테스트 키트에는 ui.focus 구현이 없어($.ui.focus 가 「no implementation」으로 실패) 이동 요청 자체는 볼 수 없다.
// 대신 포커스 대상은 한 함수(focusKeyOf)가 정해 $.ui.focus 와 autoFocus 에 같이 쓰므로, 화면마다 autoFocus 가 붙은
// 요소가 정확히 그 하나인지 본다. 포커스 실패가 화면 전환을 막지 않는다는 것도 함께 확인된다(실패해도 새 화면이 그려진다).
const focusTargets = async (ui: any) => (await ui.findAll({})).filter((el: any) => el.props?.autoFocus).map((el: any) => el.key)
const TWO_KEYS = { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\nai-rev\t10-12\n' }, 'gw-session show': { exitCode: 0, stdout: '' } }

test('포커스: 고르기 → 새 AI 추가 → 돌아가기 → 관리, 화면마다 첫 요소 하나만 포커스 대상이다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, TWO_KEYS)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  expect(await focusTargets(ui)).toEqual(['gw-pick-me'])
  await ui.press({ key: 'gw-add' }) // 결함 B — 누른 버튼이 사라져도 키 칸이 포커스 대상
  expect(await focusTargets(ui)).toEqual(['gw-key'])
  await ui.press({ key: 'gw-back' })
  expect(await focusTargets(ui)).toEqual(['gw-pick-me'])
  await ui.press({ key: 'gw-manage' })
  expect(await focusTargets(ui)).toEqual(['gw-rekey-ai-dev'])
  await ui.press({ key: 'gw-rekey-ai-rev' }) // 관리 › 키 바꾸기도 추가 화면이다 — 키 칸
  expect(await focusTargets(ui)).toEqual(['gw-key'])
  expect((await ui.find({ key: 'gw-name' }))?.text).toBe('ai-rev')
  await ui.unmount()
})

test('포커스: 저장 화면은 바꾸기 하나만 포커스 대상이다(결함 A — Enter 가 나중에 로 가지 않게)', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, EMPTY)
  const ui = await fillAndSave($, FAKE_KEY, 'ai-dev')
  expect(await focusTargets(ui)).toEqual(['gw-switch-now'])
  expect(JSON.stringify(await ui.findAll({}))).toContain('✓ ai-dev 키를 확인하고 저장했습니다')
  await ui.unmount()
})

test('포커스: 관리에서 하나를 지우면 메시지를 남기고 남은 첫 줄로, 다 지우면 추가 화면의 키 칸으로', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const answers = { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\nai-rev\t10-12\n' }, 'gw-session show': { exitCode: 0, stdout: '' } }
  loginWorld(on, answers) // 응답 표를 그대로 들고 있으므로 지운 뒤의 목록은 여기를 바꿔 흉내 낸다
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-manage' })
  await ui.press({ key: 'gw-remove-ai-dev' })
  answers['gw-keys list'].stdout = 'ai-rev\t10-12\n'
  await ui.press({ key: 'gw-remove-confirm-ai-dev' })
  expect(JSON.stringify(await ui.findAll({}))).toContain('ai-dev 키를 지웠습니다')
  expect(await focusTargets(ui)).toEqual(['gw-rekey-ai-rev'])
  await ui.press({ key: 'gw-remove-ai-rev' })
  answers['gw-keys list'].stdout = ''
  await ui.press({ key: 'gw-remove-confirm-ai-rev' })
  expect(await ui.find({ key: 'gw-key' })).toBeTruthy()
  expect(await focusTargets(ui)).toEqual(['gw-key'])
  expect(JSON.stringify(await ui.findAll({}))).toContain('ai-rev 키를 지웠습니다')
  await ui.unmount()
})

test('포커스: 다시 열면 지난 화면이 아니라 새 고르기 화면의 첫 요소가 대상이다(작은 관찰 1)', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-add' })
  await ui.unmount()
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const again = await mountPane($)
  expect(await focusTargets(again)).toEqual(['gw-pick-me'])
  await again.unmount()
})

test('안전장치: 패널이 키보드를 쥐지 않은 채 추가 화면이면 붙여 넣지 말라고 먼저 알린다', { options: { server_url: SERVER_URL } }, async ($, on) => {
  loginWorld(on, EMPTY)
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const unfocused = await $.ui.mount({ plugin: 'genia-works', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: { ...PANE_PROPS, isFocused: false } })
  expect(JSON.stringify(await unfocused.findAll({}))).toContain('이 패널에 키보드가 없습니다')
  await unfocused.unmount()
  const focused = await mountPane($)
  expect(JSON.stringify(await focused.findAll({}))).not.toContain('이 패널에 키보드가 없습니다')
  await focused.unmount()
})

test('덮어쓰기 확인: 제출로 비워진 이름·키 칸을 다음 차례에 되살린다(작은 관찰 2)', { options: { server_url: SERVER_URL } }, async ($, on) => {
  const w = loginWorld(on, { 'gw-keys list': { exitCode: 0, stdout: 'ai-dev\t10-14\n' }, 'gw-session show': { exitCode: 0, stdout: '' } })
  await $.command.run({ command: LOGIN_COMMAND, args: '' })
  const ui = await mountPane($)
  await ui.press({ key: 'gw-add' })
  await ui.input({ key: 'gw-key', text: FAKE_KEY, kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'change' })
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(JSON.stringify(await ui.findAll({}))).toContain('바꿀까요')
  // 엔진은 같은 value 를 다시 넣지 않으므로 한 번 빈 값으로 그린 뒤
  expect((await ui.find({ key: 'gw-name' }))?.text ?? '').toBe('')
  await w.clock.advance(1)
  // 바로 다음 차례에 실제 값으로 다시 그린다 — 이름은 보이고 키는 가림 문자로만
  expect((await ui.find({ key: 'gw-name' }))?.text).toBe('ai-dev')
  expect((await ui.find({ key: 'gw-key' }))?.text).toBe('●'.repeat(FAKE_KEY.length))
  // 확인 상태는 그대로 — 한 번 더 저장하면 덮어쓴다
  await ui.input({ key: 'gw-name', text: 'ai-dev', kind: 'submit' })
  expect(w.runs.find((r) => r.argv[1] === 'add')?.stdin).toBe(FAKE_KEY + '\n')
  expect(await focusTargets(ui)).toEqual(['gw-switch-now'])
  await ui.unmount()
})

// prompt.submit 안전망 — 키 모양 프롬프트는 모델에 닿지 않고, 안내·로그에 키가 없다
const B43 = 'aB3dE5gH7jK9mN1pQ3rS5tU7vW9xY1zA3bC5dE7fG9h'

test('prompt.submit: 43자 ak_ 키가 든 프롬프트는 막고 키를 토스트·로그에 싣지 않는다', async ($, on) => {
  const key = 'ak_' + B43
  const seen: string[] = []
  on('ui.toast', (_$: any, e: any, next: any) => { seen.push(JSON.stringify(e)); return next(e) })
  on('prompt.submit', (_$: any, e: any) => { seen.push('REACHED ' + e.text); return { text: e.text } })
  const r: any = await $.prompt.submit({ text: `이 키 써 줘 ${key}` })
  expect(typeof r.drop).toBe('string')
  expect(r.drop).toContain('Ctrl+U')
  expect(JSON.stringify(r)).not.toContain(B43)
  expect(seen.join('\n')).not.toContain(B43)
  expect(seen.some((s) => s.startsWith('REACHED'))).toBe(false)
})

test('prompt.submit: 보통 프롬프트와 짧은 가짜 키는 통과한다', async ($, on) => {
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  expect(((await $.prompt.submit({ text: 'hi' })) as any).text).toBe('hi')
  expect(((await $.prompt.submit({ text: 'ak_FAKE_ABC123 형식' })) as any).text).toBe('ak_FAKE_ABC123 형식')
})
