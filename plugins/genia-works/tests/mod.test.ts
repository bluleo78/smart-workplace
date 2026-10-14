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

test('logout: 선택을 지우고 다시 연결', async ($, on) => {
  const calls = stubScripts(on, { 'gw-session clear': { exitCode: 0 } })
  on('command.run', { command: 'mcp' }, () => ({}))
  const r = await $.command.run({ command: LOGOUT_COMMAND, args: '' })
  expect(r.text).toContain('내 토큰')
  expect(calls.some((c) => c[1] === 'clear')).toBe(true)
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
  mock.env(on, {})
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  const statuses: string[] = []
  on('ui.status', (_$: any, e: any) => { statuses.push(JSON.stringify(e)); return { value: undefined } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
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
  const r = await $.command.run({ command: AS_COMMAND, args: '' })
  expect(r.text).toContain('현재: ai-dev')
  expect(r.text).toContain('ai-dev, ai-rev')
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
function loginWorld(on: any, answers: Record<string, { exitCode: number; stdout?: string; stderr?: string }>, fetchStatus = 200) {
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
    return { value: { status: fetchStatus, ok: fetchStatus >= 200 && fetchStatus < 300, headers: {}, text: '' } }
  })
  on('ui.open', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.toast', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  on('ui.status', (_$: any, e: any) => { shown.push(JSON.stringify(e)); return { value: undefined } })
  mock.env(on, {})
  return { runs, fetches, shown, scripts: () => runs.map((r) => r.argv.slice(1).join(' ')) }
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
  expect(w.scripts().some((s) => s.startsWith('keys add') || s.startsWith('add'))).toBe(false)
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
  const order = w.runs.map((r) => r.argv[1]).filter((a) => a === 'clear' || a === 'remove')
  expect(order).toEqual(['clear', 'remove'])
  expect(w.runs.find((r) => r.argv[1] === 'remove')?.argv[2]).toBe('ai-dev')
  await ui.unmount()
})
