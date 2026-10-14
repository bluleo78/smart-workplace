// genia-works mod — 세션별 접속 신원 선택(로그인 패널·전환·로그아웃), 신원 상태 줄, 키 파일 읽기 차단,
// 기존 수동 등록 정리. 토큰 주입은 하지 않는다(헤더 스크립트 담당 — 플러그인 MCP 가 mod 보다 먼저 연결된다).
// 규칙: $ 를 쓰는 코드는 모두 이 파일 안에 둔다(다른 파일 함수에 $ 를 넘기면 검증이 실패). lib.js 는 순수 함수만.
import { COMMANDS, parseKeyList, identityLabel, isKeyPath, END_CLEARS } from './lib.js'

const SERVER = 'plugin:genia-works:genia-works'
let opts = {}

// 플러그인 scripts/ 의 sh 스크립트 실행 — 키 저장소·세션 선택 파일은 스크립트만 다룬다(원자적 교체·권한 규칙을 한곳에).
async function script($, name, args, stdin) {
  const init = stdin === undefined ? {} : { stdin }
  return $.process.run([$.plugin.root + '/scripts/' + name, ...args], init)
}

// 상태 줄 — 지금 이 세션이 어느 신원으로 접속하는지 늘 보이게 한다. 고른 이름의 키가 없으면 그 사실을 직접 보인다.
async function refreshStatus($) {
  const shown = await script($, 'gw-session', ['show'])
  const selected = shown.exitCode === 0 ? shown.stdout.trim() : ''
  const as = await $.env.get('GENIA_WORKS_AS')
  const envToken = await $.env.get('GENIA_WORKS_TOKEN')
  const pick = selected || as
  let keyMissing = false
  if (pick && pick !== 'me') keyMissing = (await script($, 'gw-keys', ['has', pick])).exitCode !== 0
  $.ui.status(identityLabel({ selected, as, hasEnvToken: Boolean(envToken), keyMissing }))
}

// 다시 연결 — 명령 처리 안에서 바로 $.command.run 을 부르면 턴을 막아 거부되므로 타이머로 미룬다(3차 실험).
function reconnectSoon($) {
  $.clock.after(300, async () => {
    try {
      await $.command.run({ command: 'mcp', args: 'reconnect ' + SERVER })
    } catch (err) {
      $.ui.toast('genia-works 다시 연결 실패: ' + String(err))
    }
    await refreshStatus($)
  })
}

// 신원 전환 — 선택 파일을 쓰고 다시 연결한다. 키 없는 이름은 저장하지 않는다.
async function switchTo($, name) {
  const r = await script($, 'gw-session', ['select', name])
  if (r.exitCode === 4) return `${name} 키가 없습니다 — ${COMMANDS.login} 에서 「새 AI 추가」로 등록하세요`
  if (r.exitCode !== 0) return '이 세션을 찾지 못해 바꾸지 못했습니다'
  reconnectSoon($)
  return name === 'me' ? '내 토큰으로 접속합니다' : `${name} 로 접속합니다`
}

// as 인자 없음 — 현재 신원과 등록된 이름(키 값 없이)
async function describe($) {
  const list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  const shown = (await script($, 'gw-session', ['show'])).stdout.trim()
  const names = list.length ? list.map((k) => k.name).join(', ') : '(없음)'
  return `현재: ${shown || '기본'} · 등록된 AI: ${names}`
}

export function register(on, options) {
  opts = options ?? {}

  on('session.start', async ($, e, next) => {
    await refreshStatus($)
    return next(e)
  })

  // 플러그인 명령 파일(commands/*.md)의 실행을 가로채 모델 턴 없이 처리한다(판정 8).
  // 가로채기가 실패하면 명령 파일 본문이 모델 프롬프트로 가므로 .catch 로 실패 안내를 돌려준다. 문구 앞의 플러그인 이름은 Claude Code 가 붙인다.
  on('command.run', { command: 'genia-works:as' }, async ($, e) => {
    const name = e.args.trim()
    return { text: name ? await switchTo($, name) : await describe($) }
  }).catch(() => ({ text: '신원을 바꾸지 못했습니다. 잠시 뒤 다시 시도하세요' }))

  on('command.run', { command: 'genia-works:logout' }, async ($) => {
    const r = await script($, 'gw-session', ['clear'])
    if (r.exitCode !== 0) return { text: '이 세션을 찾지 못했습니다' }
    reconnectSoon($)
    return { text: '이 세션을 내 토큰으로 되돌렸습니다(등록한 키는 그대로)' }
  }).catch(() => ({ text: '로그아웃하지 못했습니다. 잠시 뒤 다시 시도하세요' }))

  // 세션 끝 — 종료·로그아웃일 때만 선택을 지운다. 예산 1.5초라 파일 하나만 지운다.
  on('session.end', async ($, e, next) => {
    if (END_CLEARS.has(e.reason)) await script($, 'gw-session', ['clear'])
    return next(e)
  })

  // 키 저장소 읽기 차단 — 키가 대화(기록·모델 입력)로 들어가지 않게 한다. 핸들러가 실패해도 막는 쪽으로 닫는다(판정 4).
  on('tool.call', async ($, e, next) => {
    if (isKeyPath(JSON.stringify(e))) {
      return { deny: 'genia-works 키 저장소(~/.genia-works)는 열 수 없습니다. 신원 확인은 ' + COMMANDS.as + ' 를 쓰세요.' }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'genia-works 키 저장소 검사에 실패해 이 도구 호출을 막았습니다' }))
}
