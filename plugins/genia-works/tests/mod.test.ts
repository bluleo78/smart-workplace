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
