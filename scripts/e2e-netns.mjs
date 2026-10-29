#!/usr/bin/env node
// E2E 를 바깥과 끊긴 자기 네트워크 네임스페이스에서 돌린다(WP-1097).
//
// 왜: 같은 기계의 다른 세션이 docker 컨테이너·네트워크(Testcontainers·격리 라이브 스택)를 띄우고 내리면
// 브리지·veth 인터페이스의 주소가 바뀌고, Chromium 은 그 netlink 알림을 「네트워크가 바뀌었다」로 보고
// 진행 중인 요청을 net::ERR_NETWORK_CHANGED 로 끊는다 — 앱이 localhost 만 써도 그렇다. 그러면 앱 청크가
// 덜 받아져 화면 요소를 못 찾고 실패한다. 이를 끄는 Chromium 실행 인자는 없다.
// 러너·웹 서버·브라우저를 모두 새 네트워크 네임스페이스(루프백 + 안에서만 쓰는 가짜 장치)에 넣으면 바깥 인터페이스 변화가 보이지 않는다.
// E2E 는 백엔드 없이 page.route 모킹과 자체 서버(vite·동기화 서버)만 쓰므로 바깥 네트워크가 필요 없다.
//
// 방법: `unshare -rn` 으로 사용자+네트워크 네임스페이스를 만들어(권한 없이 가능) lo 를 올린 뒤,
// 한 번 더 사용자 네임스페이스를 겹쳐 원래 uid·gid 로 돌아가 명령을 실행한다(안에서 root 로 보이지 않게).
// 리눅스가 아니면 그대로, 격리를 못 쓰면(권한 없는 네임스페이스 막힘·ip 없음·util-linux 2.36 미만 등) 막은 이유를 알리고 그대로 실행한다.
// 브라우저 창·UI 모드(INTERACTIVE_FLAGS·PWDEBUG)도 격리하지 않는다. E2E_NETNS=0 이면 끈다.
import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 격리 없이 돌 때 알림에 붙이는 위험 */
const RISK = '— docker 네트워크 변화 때 ERR_NETWORK_CHANGED 로 깨질 수 있다'
/** 가능 여부 확인이 멈추면(커널 모듈 적재 등) E2E 전체가 서지 않게 두는 시간 */
const PROBE_TIMEOUT_MS = 10_000

/**
 * 네임스페이스 안에서 lo 를 올리고 원래 uid·gid 로 돌아가 명령을 실행하는 셸 스크립트.
 * ip 가 /usr/sbin 에만 있는 배포판(일반 사용자 PATH 에 없음)도 있어 PATH 를 덧붙인다.
 *
 * lo 만 있으면 Chromium 이 오프라인으로 본다(navigator.onLine === false) — 온라인일 때만 도는 앱 동작(PWA 업데이트 확인 등)이
 * 멈춰 그 E2E 가 깨진다. 그래서 네임스페이스 안에만 있는 가짜 장치(dummy, 문서용 주소 192.0.2.1)를 하나 올려 온라인으로 보이게 한다.
 * 이 장치는 처음에 한 번 만들고 바뀌지 않으므로 「네트워크 변화」를 일으키지 않는다.
 */
const INNER =
  'PATH="$PATH:/usr/sbin:/sbin" && ip link set lo up && ip link add e2e0 type dummy && ip addr add 192.0.2.1/32 dev e2e0 && ip link set e2e0 up' +
  ' && u=$1 g=$2 && shift 2 && exec unshare -U --map-user="$u" --map-group="$g" -- "$@"'

/** 브라우저 창·UI 모드는 디스플레이·D-Bus 의 추상 소켓이 네트워크 네임스페이스에 묶여 격리하면 못 붙는다 */
const INTERACTIVE_FLAGS = ['--headed', '--ui', '--debug', '--ui-port', '--ui-host']

/** 창·UI 모드인지 — 값을 붙인 인자(`--ui-port=8080`)와, Playwright 처럼 0·false 가 아닌 PWDEBUG(인스펙터 창)도 본다(WP-1121) */
function isInteractive(cmd, env) {
  if (env.PWDEBUG && env.PWDEBUG !== '0' && env.PWDEBUG !== 'false') return true
  return cmd.some((a) => INTERACTIVE_FLAGS.some((f) => a === f || a.startsWith(`${f}=`)))
}

/** 격리한 명령 — plan 과 가능 여부 확인이 같은 두 단계 명령을 쓴다(확인이 실제 실행과 어긋나지 않게) */
function isolated(uid, gid, cmd) {
  return ['-rn', 'sh', '-c', INNER, 'sh', String(uid), String(gid), ...cmd]
}

/**
 * 실행할 명령을 고른다 — 격리할 수 있으면 unshare 로 감싸고, 아니면 그대로(이유와 함께).
 * 순수 함수라 환경·권한 판정(canIsolate — probe 와 같은 모양)을 인자로 받는다. canIsolate 는 격리할 차례에만 부른다(확인에 프로세스를 띄우므로).
 */
export function plan({ platform, env, canIsolate, uid, gid, cmd }) {
  const direct = { file: cmd[0], args: cmd.slice(1) }
  if (env.E2E_NETNS_ACTIVE === '1') return direct // 이미 격리된 안에서 다시 부름
  if (env.E2E_NETNS === '0') return { ...direct, notice: 'E2E_NETNS=0 — 네트워크 격리 없이 실행' }
  if (platform !== 'linux') return direct
  if (isInteractive(cmd, env)) {
    return { ...direct, notice: `브라우저 창·UI 모드는 네트워크 격리 없이 실행 ${RISK}` }
  }
  const { ok, reason } = canIsolate()
  if (!ok) return { ...direct, notice: `네트워크 네임스페이스 격리(unshare·ip)를 쓸 수 없어 격리 없이 실행(${reason}) ${RISK}` }
  return {
    file: 'unshare',
    args: isolated(uid, gid, cmd),
    // 실패 때 HTML 리포트를 띄우는 서버는 네임스페이스 안 루프백에만 열려 바깥 브라우저가 못 연다 — 열지 않고 show-report 로 본다.
    env: { E2E_NETNS_ACTIVE: '1', PLAYWRIGHT_HTML_OPEN: 'never' },
  }
}

/**
 * 실제 실행과 같은 두 단계(네트워크+사용자 네임스페이스, 원래 uid 로 겹치기)를 true 로 해 본다 — `{ ok, reason }`.
 * 못 쓰면 무엇이 막았는지(unshare·ip·dummy 장치·`--map-user`·AppArmor 중) 알 수 있게 오류 출력 마지막 줄을 reason 으로 돌려준다(WP-1121).
 */
export function probe(uid, gid) {
  // 메시지를 영어로 받아야 reasonFrom 의 줄 거르기·--map-user 판별이 맞는다.
  const r = spawnSync('unshare', isolated(uid, gid, ['true']), {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    timeout: PROBE_TIMEOUT_MS,
  })
  return r.status === 0 ? { ok: true } : { ok: false, reason: reasonFrom(r) }
}

/**
 * 실패한 확인(spawnSync 결과)에서 막은 이유 한 줄을 뽑는다 — 실행 실패면 그 오류, 아니면 오류 출력 마지막 줄.
 * unshare 가 덧붙이는 「Try 'unshare --help'…」 안내는 뺀다.
 */
export function reasonFrom({ error, status, stderr }) {
  if (error) return { ENOENT: 'unshare 가 없다', ETIMEDOUT: `확인이 ${PROBE_TIMEOUT_MS / 1000}초 안에 끝나지 않았다` }[error.code] ?? error.message
  const last =
    stderr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('Try '))
      .at(-1) || `종료 코드 ${status}`
  // util-linux 2.35 이하(Ubuntu 20.04 등)의 unshare 는 원래 uid 로 겹치는 --map-user 를 모른다.
  return /map-(user|group)/.test(last) ? `${last} — util-linux 2.36 이상 필요` : last
}

function main() {
  const cmd = process.argv.slice(2)
  if (cmd.length === 0) {
    console.error('사용법: node scripts/e2e-netns.mjs <명령> [인자...]')
    process.exit(2)
  }
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  const p = plan({ platform: process.platform, env: process.env, canIsolate: () => probe(uid, gid), uid, gid, cmd })
  if (p.notice) console.warn(`[e2e-netns] ${p.notice}`)
  const child = spawn(p.file, p.args, { stdio: 'inherit', env: { ...process.env, ...p.env } })
  child.on('error', (err) => {
    console.error(`[e2e-netns] ${p.file} 을(를) 실행하지 못했다: ${err.message}`)
    process.exit(127)
  })
  // Ctrl+C 는 터미널이 프로세스 그룹 전체(러너 포함)에 보낸다 — 한 번 더 넘기면 러너가 강제 종료로 보고 웹 서버 정리를
  // 건너뛰므로 여기서는 무시만 한다. SIGTERM(게이트 timeout 등)은 이 프로세스에만 오니 안으로 넘긴다.
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  // 신호로 끝났으면 셸 관례(128 + 신호 번호)로 끝낸다 — 위 처리기가 있어 자기에게 다시 보내면 끝나지 않는다.
  child.on('exit', (code, signal) => process.exit(signal ? 128 + constants.signals[signal] : (code ?? 1)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
