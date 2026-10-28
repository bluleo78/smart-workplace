// e2e-netns 의 실행 계획(WP-1097) — 격리할 수 있으면 unshare 로 감싸고, 아니면 그대로 실행한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { plan } from './e2e-netns.mjs'

const yes = () => true
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

test('브라우저 창·UI 모드는 격리하지 않고 알린다', () => {
  for (const flag of ['--headed', '--ui', '--debug']) {
    const p = plan({ ...base, cmd: ['playwright', 'test', flag] })
    assert.equal(p.file, 'playwright')
    assert.match(p.notice, /브라우저 창·UI 모드/)
  }
})

test('격리를 쓸 수 없으면 이유를 알리고 그대로 실행한다', () => {
  const p = plan({ ...base, canIsolate: () => false })
  assert.equal(p.file, 'playwright')
  assert.match(p.notice, /unshare·ip/)
})

// 실제 감싸개를 돌려 본다(네트워크 장치는 네임스페이스별인 /proc/net/dev 로 — /sys 는 호스트 것이 보인다) — 셸 스크립트(인자 자리·shift·uid 겹치기)가 깨지면 위 계획 테스트로는 못 잡는다.
const canRun = process.platform === 'linux' && spawnSync('unshare', ['-rn', 'true']).status === 0
// 장치는 lo 와, 브라우저가 온라인으로 보게 하는 안쪽 전용 가짜 장치 e2e0 뿐이다(lo 만이면 navigator.onLine 이 false).
test('실제로 감싸면 원래 uid·gid 이고 네트워크 장치는 lo 와 가짜 장치 e2e0 뿐이다', { skip: !canRun && '권한 없는 네임스페이스를 못 만드는 환경' }, () => {
  const script = fileURLToPath(new URL('./e2e-netns.mjs', import.meta.url))
  const env = { ...process.env }
  delete env.E2E_NETNS_ACTIVE
  delete env.E2E_NETNS
  const r = spawnSync(process.execPath, [script, 'sh', '-c', 'id -u; id -g; tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " "; echo $E2E_NETNS_ACTIVE'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), [String(process.getuid()), String(process.getgid()), 'lo', 'e2e0', '1'])
})
