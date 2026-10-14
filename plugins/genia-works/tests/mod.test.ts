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
