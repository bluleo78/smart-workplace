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
function loginWorld(on: any, answers: Record<string, { exitCode: number; stdout?: string; stderr?: string }>, fetchStatus: number | 'error' | 'hang' | 'slow' = 200) {
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
  mock.env(on, {})
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
  const order = w.runs.map((r) => r.argv[1]).filter((a) => a === 'clear' || a === 'remove')
  expect(order).toEqual(['clear', 'remove'])
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
  const shown: string[] = []
  const calls: string[] = []
  const claudeJson = o.claudeJson ?? { mcpServers: { 'genia-works': OLD_CONFIG } }
  on('fs.read', (_$: any, e: any) => ({ value: String(e.path).endsWith('/.claude.json') ? JSON.stringify(claudeJson) : (() => { throw new Error('ENOENT') })() }))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', (_$: any, e: any) => {
    runs.push(e.argv)
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
  return { start, runs, shown, calls, removes, adds }
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

for (const [label, o] of [['성공', {}], ['호출 실패', { callError: true }], ['연결 안 됨', { connect: { isConnected: false, reason: 'failed', message: 'x' } }], ['확인 401', { fetchStatus: 401 }]] as const) {
  test(`수동 등록 정리: 옛 토큰이 토스트·로그·상태 줄 어디에도 새지 않는다 (${label})`, { options: { server_url: SERVER_URL, token: NEW_TOKEN } }, async ($, on) => {
    const w = cleanupWorld(on, o as any)
    await w.start($)
    const text = w.shown.join('|')
    expect(text).not.toContain(OLD_TOKEN)
    expect(text).not.toContain(NEW_TOKEN)
  })
}
