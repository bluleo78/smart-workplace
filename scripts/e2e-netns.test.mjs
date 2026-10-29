// e2e-netns 의 실행 계획(WP-1097) — 격리할 수 있으면 unshare 로 감싸고, 아니면 그대로 실행한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { plan, probe, reasonFrom } from './e2e-netns.mjs'

const yes = () => ({ ok: true })
const base = { platform: 'linux', env: {}, canIsolate: yes, uid: 1000, gid: 1001, cmd: ['playwright', 'test', '--grep', '@smoke'] }
const direct = { file: 'playwright', args: ['test', '--grep', '@smoke'] }

test('리눅스에서 격리할 수 있으면 unshare 로 감싸 원래 uid·gid 로 명령을 실행하고 리포트 서버는 열지 않는다', () => {
  const p = plan(base)
  assert.equal(p.file, 'unshare')
  assert.deepEqual(p.args.slice(0, 3), ['-rn', 'sh', '-c'])
  assert.deepEqual(p.args.slice(4), ['sh', '1000', '1001', 'playwright', 'test', '--grep', '@smoke'])
  assert.deepEqual(p.env, { E2E_NETNS_ACTIVE: '1', PLAYWRIGHT_HTML_OPEN: 'never' })
  assert.equal(p.notice, undefined)
})

test('이미 격리된 안에서 다시 부르면 겹치지 않고, 가능 여부 확인도 하지 않는다', () => {
  const never = () => assert.fail('확인하면 안 된다')
  assert.deepEqual(plan({ ...base, canIsolate: never, env: { E2E_NETNS_ACTIVE: '1' } }), direct)
  assert.match(plan({ ...base, canIsolate: never, env: { E2E_NETNS: '0' } }).notice, /E2E_NETNS=0/)
  assert.deepEqual(plan({ ...base, canIsolate: never, platform: 'darwin' }), direct)
})

test('브라우저 창·UI 모드는 격리하지 않고 알린다 — 값을 붙인 UI 서버 인자와 PWDEBUG 도', () => {
  const cases = [
    ...['--headed', '--ui', '--debug', '--ui-port=8080', '--ui-host=0.0.0.0'].map((flag) => ({ cmd: ['playwright', 'test', flag] })),
    { cmd: ['playwright', 'test', '--ui-port', '8080'] },
    { env: { PWDEBUG: '1' } },
    { env: { PWDEBUG: 'console' } },
  ]
  for (const c of cases) {
    const p = plan({ ...base, ...c })
    assert.equal(p.file, 'playwright', JSON.stringify(c))
    assert.match(p.notice, /브라우저 창·UI 모드/)
  }
  // 이름이 비슷한 다른 인자·끈 PWDEBUG 는 격리한다
  assert.equal(plan({ ...base, cmd: ['playwright', 'test', '--headed-ish'] }).file, 'unshare')
  for (const off of ['0', 'false']) assert.equal(plan({ ...base, env: { PWDEBUG: off } }).file, 'unshare')
})

test('격리를 쓸 수 없으면 막은 이유를 붙여 알리고 그대로 실행한다', () => {
  const p = plan({ ...base, canIsolate: () => ({ ok: false, reason: 'ip: not found' }) })
  assert.equal(p.file, 'playwright')
  assert.match(p.notice, /unshare·ip/)
  assert.match(p.notice, /\(ip: not found\)/)
})

test('막은 이유는 오류 출력 마지막 줄 — unshare 의 도움말 안내는 빼고, --map-user 를 모르면 필요한 버전을 붙인다', () => {
  assert.equal(reasonFrom({ status: 1, stderr: 'sh: 1: ip: not found\n' }), 'sh: 1: ip: not found')
  assert.equal(
    reasonFrom({ status: 1, stderr: "unshare: unrecognized option '--map-user=1000'\nTry 'unshare --help' for more information.\n" }),
    "unshare: unrecognized option '--map-user=1000' — util-linux 2.36 이상 필요",
  )
  assert.equal(reasonFrom({ status: 2, stderr: '' }), '종료 코드 2')
  assert.equal(reasonFrom({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }), 'unshare 가 없다')
  assert.match(reasonFrom({ error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }), /초 안에 끝나지 않았다/)
})

// 실제 감싸개를 돌려 본다(네트워크 장치는 네임스페이스별인 /proc/net/dev 로 — /sys 는 호스트 것이 보인다) — 셸 스크립트(인자 자리·shift·uid 겹치기)가 깨지면 위 계획 테스트로는 못 잡는다.
// 감싸개와 같은 확인(probe)으로 건너뛴다 — `unshare -rn` 만 보면 ip·--map-user 가 없는 기계에서 격리 없이 돈 결과를 실패로 본다(WP-1121).
const check = process.platform === 'linux' ? probe(process.getuid(), process.getgid()) : { ok: false, reason: '리눅스가 아님' }
// 장치는 lo 와, 브라우저가 온라인으로 보게 하는 안쪽 전용 가짜 장치 e2e0 뿐이다(lo 만이면 navigator.onLine 이 false).
test('실제로 감싸면 원래 uid·gid 이고 네트워크 장치는 lo 와 가짜 장치 e2e0 뿐이다', { skip: !check.ok && `격리를 쓸 수 없는 환경 — ${check.reason}` }, () => {
  const script = fileURLToPath(new URL('./e2e-netns.mjs', import.meta.url))
  const env = { ...process.env }
  delete env.E2E_NETNS_ACTIVE
  delete env.E2E_NETNS
  const r = spawnSync(process.execPath, [script, 'sh', '-c', 'id -u; id -g; tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " "; echo $E2E_NETNS_ACTIVE'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), [String(process.getuid()), String(process.getgid()), 'lo', 'e2e0', '1'])
})
