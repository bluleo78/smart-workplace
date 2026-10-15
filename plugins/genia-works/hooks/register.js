// genia-works mod — 세션별 접속 신원 선택(로그인 패널·전환·로그아웃), 신원 상태 줄, 키 파일 읽기 차단,
// 기존 수동 등록 정리. 토큰 주입은 하지 않는다(헤더 스크립트 담당 — 플러그인 MCP 가 mod 보다 먼저 연결된다).
// 규칙: $ 를 쓰는 코드는 모두 이 파일 안에 둔다(다른 파일 함수에 $ 를 넘기면 검증이 실패). lib.js 는 순수 함수만.
import { COMMANDS, parseKeyList, identityLabel, isKeyPath, toolTargets, END_CLEARS, applyMaskedInput, maskOf, initializeBody, validName, validKey, findManualRegistrations, isAiKeyRegistration, isHeaderScriptCall, HEADER_SCRIPT_DENY, KEY_PATH_DENY, mentionsHost, sameServer, isHeadless, HEADLESS_SWITCH, HEADLESS_LOGIN, containsSecretKey, PROMPT_KEY_DROP } from './lib.js'

const SERVER = 'plugin:genia-works:genia-works'
let opts = {}
// 대화형 여부 — session.start 가 알려 준다(모르면 undefined → 대화형으로 본다). 명령의 origin 과 함께 isHeadless 로 판정.
let interactive

// 플러그인 scripts/ 의 sh 스크립트 실행 — 키 저장소·세션 선택 파일은 스크립트만 다룬다(원자적 교체·권한 규칙을 한곳에).
async function script($, name, args, stdin) {
  const init = stdin === undefined ? {} : { stdin }
  return $.process.run([$.plugin.root + '/scripts/' + name, ...args], init)
}

// 등록된 AI 키 목록(키 값 없이) — 실패해도 빈 목록으로 본다(종료 코드는 보지 않는다).
async function listKeys($) {
  return parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
}

// 이 세션에서 고른 이름(없으면 빈 문자열) — 종료 코드는 보지 않는다. 종료 코드가 필요한 곳(currentLabel)은 직접 부른다.
async function sessionSelection($) {
  return (await script($, 'gw-session', ['show'])).stdout.trim()
}

// 토스트 표시 시간 — 길게 읽어야 하는 안내(12초)와 보통 안내(10초).
const TOAST_LONG = { timeoutMs: 12000 }
const TOAST_MID = { timeoutMs: 10000 }

// 지금 이 세션의 신원 문구 — 상태 줄과 as(인자 없음)가 같은 입력으로 같은 문구를 얻는다.
// 고른 이름의 키가 없으면 그 사실을 직접 보이고, 내 토큰이 어디에도 없으면 설정 안내를 보인다.
async function currentLabel($) {
  // 서로 기대지 않는 읽기는 함께 보낸다. 고른 이름의 키 확인(has)만 그 이름에 기대므로 뒤에 한다.
  const [shown, as, envToken] = await Promise.all([script($, 'gw-session', ['show']), $.env.get('GENIA_WORKS_AS'), $.env.get('GENIA_WORKS_TOKEN')])
  const selected = shown.exitCode === 0 ? shown.stdout.trim() : ''
  const pick = selected || as
  let keyMissing = false
  if (pick && pick !== 'me') keyMissing = (await script($, 'gw-keys', ['has', pick])).exitCode !== 0
  return identityLabel({ selected, as, hasEnvToken: Boolean(envToken), keyMissing, hasToken: Boolean(envToken || opts.token) })
}

// 상태 줄 — 지금 이 세션이 어느 신원으로 접속하는지 늘 보이게 한다.
async function refreshStatus($) {
  $.ui.status(await currentLabel($))
}

// 다시 연결 — 명령 처리 안에서 바로 $.command.run 을 부르면 턴을 막아 거부되므로 타이머로 미룬다(3차 실험).
function reconnectSoon($) {
  $.clock.after(300, async () => {
    try {
      await $.command.run({ command: 'mcp', args: 'reconnect ' + SERVER })
    } catch (err) {
      $.ui.toast('genia-works 다시 연결 실패: ' + String(err))
    }
    // 상태 줄 갱신 실패(스크립트 오류 등)는 상태 줄만 건너뛴다.
    try {
      await refreshStatus($)
    } catch {}
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
  const [list, label] = await Promise.all([listKeys($), currentLabel($)])
  const names = list.length ? list.map((k) => k.name).join(', ') : '(없음)'
  return `현재: ${label} · 등록된 AI: ${names}`
}

const PANE = 'genia-works-login'
const PANE_TITLE = 'genia-works 로그인'
// 패널 상태 — keyBuf(실제 키)는 저장 성공·실패, 검증·확인 실패, 화면 이동(go·키 바꾸기), 패널 닫기에서 비운다
// (덮어쓰기 확인 단계만 같은 키로 다시 누르도록 남긴다). 화면에는 maskOf(keyBuf)만 그린다.
// attempt: 열기·이동·닫기마다 올라가는 번호 — 서버 확인 중에 화면이 바뀌었으면 늦게 온 저장을 버린다.
let attempt = 0

// 패널 상태 한 벌 — 기본값에 over 를 덮어 쓴다(필드를 한곳에서 정의).
function blankPane(over) {
  return { view: 'pick', list: [], current: '', envToken: false, keyBuf: '', name: '', message: '', confirm: '', rekey: '', busy: false, blank: false, ...over }
}
let pane = blankPane()

// 입력해 둔 키를 버리고 진행 중인 서버 확인을 무효로 한다 — 열기·이동·닫기 어디서나 같이 해야 하는 두 가지.
function dropSecret() {
  attempt++
  pane.keyBuf = ''
}

// 화면 이동 — 키를 버리고 메시지·확인·키 바꾸기 표시를 지운 뒤 patch 를 적용한다.
function enterView(view, patch) {
  dropSecret()
  Object.assign(pane, { view, message: '', confirm: '', rekey: '' }, patch)
}

// 화면마다 포커스를 둘 첫 요소 — 화면이 바뀌면 포커스가 있던 요소가 사라지므로 여기로 직접 옮긴다.
function focusKeyOf(p) {
  if (p.view === 'add') return 'gw-key'
  if (p.view === 'saved') return 'gw-switch-now'
  if (p.view === 'pick') return 'gw-pick-me'
  return p.list.length ? 'gw-rekey-' + p.list[0].name : 'gw-back'
}

// 다시 그리고 그 화면의 첫 요소로 포커스를 옮긴다 — 패널 안에서 화면이 바뀔 때 autoFocus 는 적용되지 않는다
// (엔진은 사이트가 키보드를 「가져갈」 때만 autoFocus 를 쓴다). 포커스가 있던 버튼이 사라지면 키보드가 패널 밖
// (Claude 입력창)으로 나가 붙여 넣은 키가 평문으로 들어갈 수 있으므로(결함 B), 옛 버튼이 아직 그려져 패널이 키를 쥔
// 지금 $.ui.focus 를 먼저 걸고 그다음 다시 그리기를 요청한다 — 아직 없는 요소는 다음 그림까지(시간 제한 안에서) 기다리므로,
// 기다림은 이 다시 그리기로 풀린다(라이브: 「＋ 새 AI 추가」 Enter 뒤 30ms 만에 붙여 넣어도 키 칸에 들어간다).
// 거절되면(이미 키보드를 잃었다) 패널이 아직 열려 있을 때만 focus 로 다시 열어 키보드를 되찾은 뒤 한 번 더 옮긴다
// (입력창이 비어 있을 때만 받아 준다 — 붙여 넣은 글이 이미 입력창에 있으면 되찾지 못하고, 추가 화면은 경고 줄을 보인다).
// 포커스 실패는 저장·전환·닫기를 막지 않는다. ui.render 처리기 안에서는 부르지 않는다(자기 그림을 기다릴 수 없다).
async function refocus($) {
  const key = focusKeyOf(pane)
  let moving
  try {
    moving = $.ui.focus({ requestId: PANE, key }) // 기다리지 않고 먼저 건다 — 다시 그리기 전에 불러야 한다
  } catch {}
  $.ui.invalidate('ui.render')
  try {
    const r = await moving
    if (!r?.deny) return
    if (!(await $.ui.panes()).some((p) => p.id === PANE)) return // 그사이 닫혔다 — 다시 열지 않는다
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
    await $.ui.focus({ requestId: PANE, key })
  } catch {} // 포커스가 안 돼도 새 화면은 이미 그리라고 했다
}

// 제출 뒤 입력칸 되살리기 — 엔진은 Enter 로 제출한 입력칸의 글을 비우고, 그리는 value 가 지난번과 같으면 다시 넣지 않는다
// (덮어쓰기 확인 화면에서 이름칸이 비어 보이던 문제). 한 번 빈 값으로 그린 뒤 바로 다음 차례에 실제 값으로 다시 그려 되살린다.
// 빈 값 그림은 onInput 을 부르지 않는다(라이브 확인) — pane.name·keyBuf 는 그대로다.
function refillFields($) {
  pane.blank = true
  $.ui.invalidate('ui.render')
  $.clock.after(0, () => {
    pane.blank = false
    $.ui.invalidate('ui.render')
  })
}

// 화면 이동 + 다시 그리기 + 포커스 — 패널 안의 화면 전환은 모두 여기를 거친다.
async function showView($, view, patch) {
  enterView(view, patch)
  await refocus($)
}

// 패널 열기 — 등록된 AI 가 없으면 바로 「새 AI 추가」 화면으로 간다.
async function openLogin($) {
  const [list, selected, as, token] = await Promise.all([listKeys($), sessionSelection($), $.env.get('GENIA_WORKS_AS'), $.env.get('GENIA_WORKS_TOKEN')])
  // 현재 신원 — 세션 선택이 없으면 GENIA_WORKS_AS 가 가리키는 이름을 현재로 본다(헤더 스크립트와 같은 우선순위)
  const current = selected || (as ?? '')
  dropSecret() // 이전 패널의 키를 버리고 진행 중인 확인을 무효로 한다
  pane = blankPane({ view: list.length ? 'pick' : 'add', list, current, envToken: Boolean(token) })
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
  // 다시 열 때 엔진이 지난 그림(settled)을 재사용하고 autoFocus 도 그 지난 그림에 건다. 새 상태로 다시 그리게 하고
  // 포커스를 새 그림의 첫 요소로 옮긴다(입력창에 글이 있어 키보드를 받지 못했으면 거절되고 그대로 둔다).
  await refocus($)
}

// 키 확인 — 그 키로 initialize 를 보내 401 이면 거절. 네트워크 오류·무응답(10초)은 저장하지 않고 고정 문구로 알린다(오류 원문엔 키가 섞일 수 있어 쓰지 않는다).
async function verifyKey($, key) {
  const ac = new AbortController()
  try {
    const timeout = $.clock.sleep(10000, { signal: ac.signal }).then(() => 'timeout', () => 'aborted')
    const fetched = $.http
      .fetch(opts.server_url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: initializeBody(),
      })
      .catch(() => 'error')
    const r = await Promise.race([fetched, timeout])
    if (r === 'timeout') return '서버 응답이 없습니다 — 잠시 뒤 다시 시도하세요'
    if (r === 'error') return '서버에 접속하지 못했습니다 — 잠시 뒤 다시 시도하세요'
    if (r.status === 401) return '키가 맞지 않습니다(만료·회수 여부를 확인하세요)'
    if (!r.ok) return '서버 확인에 실패했습니다: HTTP ' + r.status
    return ''
  } finally {
    ac.abort() // 남은 타이머 정리
  }
}

// 덮어쓰기 확인 상태 되돌리기 — 확인은 「그 이름·그 시도」에만 유효하다. 실패하거나 키·이름 입력이 바뀌면 다시 묻는다.
// 단, 관리 화면의 「키 바꾸기」(rekey)로 들어온 같은 이름은 사용자가 이미 바꾸기로 골랐으므로 확인을 미리 켜 둔다(두 번 묻지 않음).
function resetConfirm() {
  pane.confirm = pane.rekey && pane.rekey === pane.name.trim() ? 'overwrite-' + pane.rekey : ''
}

// 새 키 저장 — 이름·형식 검사 → (덮어쓰기면 한 번 더 확인) → 서버 확인 → gw-keys add(stdin).
// 저장 성공·실패와 검증 실패에서는 keyBuf 를 비운다(키를 메모리에 오래 두지 않는다). 덮어쓰기 확인 단계만 같은 키로 다시 누르도록 남긴다.
// 진행 중(busy)에는 다시 눌러도 무시한다.
async function saveNewKey($) {
  if (pane.busy) return
  pane.busy = true
  try {
    const key = pane.keyBuf.trim()
    const name = pane.name.trim()
    const fail = (m) => { pane.keyBuf = ''; pane.message = m; resetConfirm() }
    if (!validName(name)) return fail('이름은 영문·숫자·._@- 만 쓸 수 있습니다(me 는 예약)')
    if (key.startsWith('swp_')) return fail('내 토큰(swp_)은 /plugin › genia-works › 설정에 넣으세요')
    if (!validKey(key)) return fail('AI 키는 ak_ 로 시작하고 영문·숫자·_- 로만 이뤄집니다')
    if (pane.list.some((k) => k.name === name) && pane.confirm !== 'overwrite-' + name) {
      pane.confirm = 'overwrite-' + name
      return void (pane.message = `${name} 키를 바꿀까요? 한 번 더 저장을 누르면 바꿉니다`)
    }
    pane.message = '확인 중…'
    $.ui.invalidate('ui.render')
    const mine = attempt
    const bad = await verifyKey($, key)
    if (mine !== attempt) return // 확인 중에 취소·이동했다 — 저장도 화면 전환도 하지 않는다
    if (bad) return fail(bad)
    const r = await script($, 'gw-keys', ['add', name], key + '\n')
    pane.keyBuf = ''
    if (r.exitCode !== 0) {
      resetConfirm()
      return void (pane.message = '저장하지 못했습니다: ' + r.stderr.trim())
    }
    // 저장 화면으로 — 제출한 입력칸이 사라지므로 포커스를 「바꾸기」로 직접 옮긴다(Enter 가 「나중에」에 걸리던 결함 A).
    await showView($, 'saved', { name, message: `✓ ${name} 키를 확인하고 저장했습니다. 지금 이 AI 로 바꿀까요?` })
  } finally {
    pane.busy = false
  }
}

// 패널 닫기 — 플러그인이 스스로 닫을 때는 자기 ui.close 처리기가 불리지 않으므로 여기서 키를 먼저 비운다.
// (사람이 Esc 로 닫는 경우는 아래 ui.close 처리기가 비운다.)
async function closePane($) {
  dropSecret()
  await $.ui.close({ id: PANE })
}

// 신원 전환 후 패널 닫기 — 결과 문장은 토스트로도 보인다.
async function pickAndClose($, name) {
  pane.message = await switchTo($, name)
  $.ui.toast(pane.message)
  await closePane($)
}

// 키 삭제 — 지금 쓰는 이름이면 세션 선택을 「내 토큰」으로 돌리고(clear 가 아니라 select me — clear 면 GENIA_WORKS_AS 로 되돌아간다) 다시 연결한 뒤 지운다. 이후 목록을 다시 읽는다. 스크립트가 실패하면 알리고 멈춘다.
// 현재 이름이 GENIA_WORKS_AS 로만 정해진 경우(세션 선택 없음)는 알림만 하고, 환경변수를 바꾸라고 알린다.
async function removeKey($, name) {
  let note = ''
  if (pane.current === name) {
    const sel = await sessionSelection($)
    if (sel === name) {
      const c = await script($, 'gw-session', ['select', 'me'])
      if (c.exitCode !== 0) return void (pane.message = '세션 선택을 돌리지 못해 지우지 않았습니다')
      reconnectSoon($)
      pane.current = ''
    } else {
      note = ' (GENIA_WORKS_AS 가 이 이름을 가리킵니다 — 환경변수를 바꾸세요)'
    }
  }
  const r = await script($, 'gw-keys', ['remove', name])
  if (r.exitCode !== 0) return void (pane.message = '키를 지우지 못했습니다: ' + r.stderr.trim())
  pane.list = await listKeys($)
  // 누른 「지우기」 버튼이 그 줄과 함께 사라지므로 화면을 다시 세우고 포커스를 옮긴다(목록이 비면 추가 화면의 키 칸).
  await showView($, pane.list.length ? 'manage' : 'add', { message: `${name} 키를 지웠습니다` + note })
}

// 패널 트리 — view 별(pick·add·saved·manage). 상태가 바뀌면 invalidate 로 다시 그린다.
function renderPane($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const redraw = () => $.ui.invalidate('ui.render')
  const go = (view) => () => showView($, view)
  // 이 화면의 포커스 대상에만 autoFocus — 사람이 ctrl+x tab 으로 패널을 다시 잡을 때도 refocus 와 같은 요소에서 시작한다.
  const target = focusKeyOf(pane)
  const af = (key) => (key === target ? { autoFocus: true } : {})
  const msg = pane.message ? h(Text, null, pane.message) : null
  let body
  if (pane.view === 'pick') {
    body = [
      h(Text, null, '이 세션을 어느 신원으로 쓸까요?'),
      h(Button, { key: 'gw-pick-me', ...af('gw-pick-me'), label: '내 토큰' + (pane.envToken ? ' (환경변수 GENIA_WORKS_TOKEN)' : '') + (pane.current === '' || pane.current === 'me' ? '  (현재)' : ''), onPress: async () => { await pickAndClose($, 'me') } }),
      ...pane.list.map((k) =>
        h(Button, { key: 'gw-pick-' + k.name, label: `${k.name}  등록 ${k.added}` + (pane.current === k.name ? '  (현재)' : ''), onPress: async () => { await pickAndClose($, k.name) } })),
      h(Button, { key: 'gw-add', label: '＋ 새 AI 추가', onPress: go('add') }),
      h(Button, { key: 'gw-manage', label: '등록된 AI 관리…', onPress: go('manage') }),
      msg,
    ]
  } else if (pane.view === 'add') {
    // 두 입력칸의 Enter — 저장 뒤 추가 화면에 머물면(확인·실패) 제출로 비워진 칸을 되살린다. 저장 화면으로 갔으면 showView 가 다시 그렸다.
    const submit = async () => {
      await saveNewKey($)
      if (pane.view === 'add') refillFields($)
    }
    body = [
      // 안전장치 — 패널이 키보드를 쥐지 않은 채 추가 화면이 보이면 알린다. 이 줄이 보일 때는 붙여 넣은 키가 이미 Claude 입력창에
      // 들어가 있을 수 있으므로(Enter 와 붙여넣기가 한꺼번에 들어온 경우) 「보내지 말고 지우기」를 먼저, 다시 붙여 넣는 방법을 다음에 적는다.
      e.props?.isFocused === false ? h(Text, { color: 'yellow' }, '⚠ 이 패널에 키보드가 없습니다 — 키가 Claude 입력창에 들어갔다면 Enter 를 누르지 말고 Ctrl+U 로 지우세요(키 모양이 든 입력은 플러그인이 보내지 못하게 막습니다). 붙여 넣으려면 ctrl+x tab 으로 패널에 온 뒤 붙여 넣으세요') : null,
      h(Input, {
        key: 'gw-key', label: 'AI 키', placeholder: '관리자 › 에이전트에서 발급한 ak_ 키', value: pane.blank ? '' : maskOf(pane.keyBuf), ...af('gw-key'),
        onInput: (v) => { pane.keyBuf = applyMaskedInput(pane.keyBuf, v); resetConfirm(); redraw() },
        onSubmit: submit,
      }),
      h(Input, {
        key: 'gw-name', label: '이름', placeholder: '이 AI 의 아이디', value: pane.blank ? '' : pane.name, submitLabel: '확인하고 저장',
        onInput: (v) => { pane.name = v; resetConfirm(); redraw() },
        onSubmit: submit,
      }),
      msg,
      h(Text, { dimColor: true }, `터미널에서 넣으려면: "${$.plugin.root}/scripts/gw-set-key" ${pane.name.trim() || '<이름>'}`),
      pane.list.length ? h(Button, { key: 'gw-back', label: '← 돌아가기', onPress: go('pick') }) : null,
      h(Button, { key: 'gw-cancel', label: '취소', onPress: async () => { await closePane($) } }),
    ]
  } else if (pane.view === 'saved') {
    body = [
      msg,
      h(Button, { key: 'gw-switch-now', ...af('gw-switch-now'), label: '바꾸기', onPress: async () => { await pickAndClose($, pane.name) } }),
      h(Button, { key: 'gw-later', label: '나중에', onPress: async () => { await closePane($) } }),
    ]
  } else {
    body = [
      h(Text, null, '등록된 AI 관리'),
      ...pane.list.flatMap((k) => [
        h(Text, { key: 'gw-name-' + k.name }, `${k.name}  등록 ${k.added}`),
        h(Button, { key: 'gw-rekey-' + k.name, ...af('gw-rekey-' + k.name), label: `${k.name} 키 바꾸기`, onPress: () => showView($, 'add', { name: k.name, rekey: k.name, confirm: 'overwrite-' + k.name }) }), // 키 바꾸기는 덮어쓰기를 이미 고른 것(resetConfirm 과 같은 규칙)
        h(Button, { key: 'gw-remove-' + k.name, label: `${k.name} 삭제`, onPress: () => { pane.confirm = 'remove-' + k.name; redraw() } }),
        pane.confirm === 'remove-' + k.name
          ? h(Box, { flexDirection: 'column' },
              h(Text, null, `${k.name} 키를 이 컴퓨터에서 지울까요?`),
              h(Button, { key: 'gw-remove-confirm-' + k.name, label: '지우기', onPress: async () => { await removeKey($, k.name); redraw() } }))
          : null,
      ]),
      msg,
      h(Button, { key: 'gw-back', ...af('gw-back'), label: '← 돌아가기', onPress: go(pane.list.length ? 'pick' : 'add') }),
    ]
  }
  return h(Box, { flexDirection: 'column' }, ...body.filter(Boolean))
}

// 기존 수동 등록 자동 정리(2026-10-15 사용자 결정) — 같은 주소에 사람이 손으로 등록한 서버가 있으면
// Claude Code 가 플러그인 서버를 가려 버린다. 플러그인 토큰으로 접속 확인을 통과하면 그 등록을 지우고 알린다.
// 이미 도는 중이면 다시 시작하지 않는다(세션 시작마다 한 번 다시 허용).
let cleanupRunning = false

// 옛 설정(f.config)에는 예전 수동 토큰이 들어 있을 수 있다 — 되살리기용으로 이 함수 안 변수에만 두고 로그·토스트에 쓰지 않는다.
async function cleanupManual($) {
  if (cleanupRunning) return
  cleanupRunning = true
  try {
    await cleanupManualInner($)
  } finally {
    cleanupRunning = false
  }
}

async function cleanupManualInner($) {
  const home = await $.env.get('HOME')
  let cfg
  try {
    const raw = await $.fs.read(home + '/.claude.json')
    // 큰 파일을 파싱하기 전에 싼 선검사 — 이 서버의 호스트가 글자로도 안 보이면 등록이 있을 수 없다(.mcp.json 경고는 그대로 하도록 빈 설정으로 이어 간다).
    cfg = mentionsHost(raw, opts.server_url) ? JSON.parse(raw) : {}
  } catch {
    return // ~/.claude.json 이 없거나 읽을 수 없으면 정리할 것이 없다
  }
  const root = await $.session.root()
  const all = findManualRegistrations(cfg, root, opts.server_url)
  await warnProjectMcp($, root)
  // AI 키(Bearer ak_)로 연결된 등록은 지우지 않는다 — 지우면 그 프로젝트가 사람 신원으로 바뀌고 키도 잃는다. 키 값은 알리지 않는다.
  const found = all.filter((f) => !isAiKeyRegistration(f.config))
  const kept = all.filter((f) => isAiKeyRegistration(f.config))
  const removeHint = (f) => `claude mcp remove ${f.name} -s ${f.scope}`
  for (const f of kept) {
    $.ui.toast(`기존 genia-works 등록(${f.name})은 AI 키로 연결돼 있어 그대로 둡니다 — 이 키를 ${COMMANDS.login} 으로 등록한 뒤 ${removeHint(f)} 로 지우세요`, TOAST_LONG)
  }
  if (found.length === 0) return
  if (!opts.token) {
    $.ui.toast('기존 genia-works 등록이 있습니다 — /plugin › genia-works › 설정에 내 토큰을 넣으면 정리합니다', TOAST_MID)
    return
  }
  // 플러그인 토큰이 서버에 통하는지 먼저 확인 — 통하지 않는데 지우면 연결이 둘 다 끊긴다.
  if (await verifyKey($, opts.token)) {
    $.ui.toast('플러그인 토큰으로 접속하지 못했습니다 — 기존 등록을 그대로 둡니다', TOAST_MID)
    return
  }
  // 되살리기 — 이미 지운 항목을 원래 설정으로 다시 등록한다. 하나라도 실패하면 false.
  // 주의: 옛 설정(토큰 포함 가능)이 잠시 명령 인자(argv)에 실린다 — add-json 이 JSON 을 인자로만 받아 피할 수 없다.
  const restore = async (done) => {
    let allOk = true
    for (const f of done) {
      try {
        const r = await $.process.run(['claude', 'mcp', 'add-json', f.name, JSON.stringify(f.config), '-s', f.scope], { cwd: root })
        if (r.exitCode !== 0) allOk = false
      } catch {
        allOk = false
      }
    }
    return allOk
  }
  const restoreToast = async (done, okText) => {
    const text = (await restore(done)) ? okText : '기존 등록을 되살리지 못했습니다 — 터미널에서 claude mcp add 로 다시 등록하세요'
    if (text) $.ui.toast(text, TOAST_LONG) // okText 가 빈 문자열이면 성공 시 따로 알리지 않는다(뒤따르는 토스트가 있다)
  }
  const removed = []
  for (const f of found) {
    let r
    try {
      r = await $.process.run(['claude', 'mcp', 'remove', f.name, '-s', f.scope], { cwd: root })
    } catch {
      await restoreToast(removed, '')
      $.ui.toast(`claude 명령을 찾지 못해 기존 등록을 지우지 못했습니다 — 터미널에서 ${removeHint(f)} 를 실행하세요`, TOAST_LONG)
      return
    }
    if (r.exitCode !== 0) {
      await restoreToast(removed, '')
      $.ui.toast(`기존 등록 ${f.name} 을 지우지 못했습니다 — 터미널에서 ${removeHint(f)} 를 실행하세요`, TOAST_LONG)
      return
    }
    removed.push(f)
  }
  let connected = false
  try {
    const c = await $.mcp.connect('genia-works') // 이 플러그인 .mcp.json 의 서버 키
    // 세션이 아직 옛 수동 서버를 들고 있으면 connect 가 그 이름(≠SERVER)으로 답한다 — 옛 연결·옛 토큰이라 확인이 되지 않으므로 연결 안 됨으로 본다.
    connected = c.isConnected && c.server === SERVER
  } catch {}
  if (!connected) {
    // 연결이 안 돼도 되살리지 않는다 — 되살리면 수동 등록이 플러그인 서버를 계속 가린다(세션 시작마다 되풀이).
    // 위 토큰 확인이 이 서버가 플러그인 토큰을 받아들임을 이미 보였으므로, 다음 시작부터는 플러그인 연결이 선다.
    // AI 키 등록을 남겨 두었다면 그것이 계속 플러그인 연결을 가리므로 「다시 시작하면 바뀝니다」를 약속하지 않는다.
    $.ui.toast(
      kept.length
        ? `기존 genia-works 수동 등록을 지웠습니다 — 남겨 둔 AI 키 등록(${kept.map((f) => f.name).join(', ')})을 지운 뒤 다시 시작해야 플러그인 연결로 바뀝니다`
        : '기존 genia-works 수동 등록을 지웠습니다 — 이 세션은 다시 시작하면 플러그인 연결로 바뀝니다',
      TOAST_LONG,
    )
    return
  }
  let ok = false
  try {
    const res = await $.mcp.call(SERVER, 'list_projects', {}) // 읽기 전용·인자 없음
    ok = !res?.isError
  } catch {}
  if (!ok) {
    // 플러그인 연결인데 도구가 안 돈다 — 확인할 수 없는 상태로 둘 수 없어 원래 등록으로 되돌린다.
    await restoreToast(removed, '플러그인 연결 확인에 실패해 기존 등록을 되살렸습니다')
    return
  }
  const scopes = [...new Set(removed.map((f) => (f.scope === 'user' ? '사용자 범위' : '이 프로젝트')))].join('·')
  $.ui.toast(`기존 genia-works 수동 등록(${scopes})을 지우고 플러그인 연결로 바꿨습니다. 이미 떠 있는 다른 세션은 다시 시작하면 바뀝니다.`, TOAST_LONG)
  await refreshStatus($)
}

// 프로젝트 .mcp.json(커밋 파일)에 같은 서버가 있으면 경고만 — 자동으로 고치지 않는다.
async function warnProjectMcp($, root) {
  try {
    const p = JSON.parse(await $.fs.read(root + '/.mcp.json'))
    const hit = Object.values(p?.mcpServers ?? {}).some((c) => c?.url && sameServer(c.url, opts.server_url))
    if (hit) $.ui.toast('이 프로젝트 .mcp.json 의 genia-works 등록이 플러그인 연결을 가립니다 — 그 항목을 지우세요', TOAST_MID)
  } catch {
    // .mcp.json 없음 — 할 일 없음
  }
}

export function register(on, options) {
  opts = options ?? {}

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    // 상태 줄은 시작을 막지 않게 타이머로 미룬다 — 스크립트 실패는 상태 줄만 건너뛴다.
    $.clock.after(0, () => refreshStatus($).catch(() => {}))
    // 수동 등록 정리 — 시작을 막지 않게 타이머로 미루고, 실패는 삼킨다. 세션 시작마다 한 번 다시 허용한다.
    // 비대화형(-p·SDK)에서는 토스트가 버려지므로 지우고도 알릴 수 없다 — 아예 건드리지 않는다.
    if (interactive !== false) $.clock.after(1500, () => cleanupManual($).catch(() => {}))
    return next(e)
  })

  // 플러그인 명령 파일(commands/*.md)의 실행을 가로채 모델 턴 없이 처리한다(판정 8).
  // 가로채기가 실패하면 명령 파일 본문이 모델 프롬프트로 가므로 .catch 로 실패 안내를 돌려준다. 문구 앞의 플러그인 이름은 Claude Code 가 붙인다.
  on('command.run', { command: 'genia-works:as' }, async ($, e) => {
    const name = e.args.trim()
    if (name && isHeadless({ interactive, origin: e.origin })) return { text: HEADLESS_SWITCH }
    return { text: name ? await switchTo($, name) : await describe($) }
  }).catch(() => ({ text: '신원을 바꾸지 못했습니다. 잠시 뒤 다시 시도하세요' }))

  on('command.run', { command: 'genia-works:logout' }, async ($, e) => {
    if (isHeadless({ interactive, origin: e.origin })) return { text: HEADLESS_SWITCH }
    // clear 가 아니라 select me — clear 면 GENIA_WORKS_AS 로 되돌아가 「내 토큰으로 되돌렸다」는 안내와 어긋난다(as me 와 같은 동작).
    const r = await script($, 'gw-session', ['select', 'me'])
    if (r.exitCode !== 0) return { text: '이 세션을 찾지 못했습니다' }
    reconnectSoon($)
    return { text: '이 세션을 내 토큰으로 되돌렸습니다(등록한 키는 그대로)' }
  }).catch(() => ({ text: '로그아웃하지 못했습니다. 잠시 뒤 다시 시도하세요' }))

  // 로그인 패널 — 명령으로 열고, 그리기는 이 패널 id 만 맡는다(다른 패널은 그대로 넘긴다).
  on('command.run', { command: 'genia-works:login' }, async ($, e) => {
    if (isHeadless({ interactive, origin: e.origin })) return { text: HEADLESS_LOGIN }
    await openLogin($)
    return {}
  }).catch(() => ({ text: '로그인 패널을 열지 못했습니다. 잠시 뒤 다시 시도하세요' }))

  on('ui.render', { component: 'Pane' }, ($, e, next) => (e.requestId !== PANE ? next(e) : renderPane($, e)))

  // 패널이 닫히면 입력해 둔 키를 즉시 비운다.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      dropSecret() // 진행 중인 서버 확인이 있어도 늦게 와서 저장하지 않게(closePane 과 같다)
    }
    return next(e)
  })

  // 세션 끝 — 종료·로그아웃일 때만 선택을 지운다. 예산 1.5초라 파일 하나만 지운다.
  on('session.end', async ($, e, next) => {
    // 정리 스크립트가 실패해도 종료 흐름(next)은 반드시 이어 간다 — 남은 파일은 헤더 스크립트의 정리가 치운다.
    try {
      if (END_CLEARS.has(e.reason)) await script($, 'gw-session', ['clear'])
    } catch {}
    return next(e)
  })

  // 키 저장소 읽기 차단 — 키가 대화(기록·모델 입력)로 들어가지 않게 한다. 핸들러가 실패해도 막는 쪽으로 닫는다(판정 4).
  on('tool.call', async ($, e, next) => {
    if (toolTargets(e).some(isKeyPath)) {
      return { deny: KEY_PATH_DENY }
    }
    // 헤더 스크립트는 활성 키를 출력하므로 모델이 직접 돌리지 못하게 한다(gw-set-key 는 키를 출력하지 않아 허용).
    if (isHeaderScriptCall(e)) return { deny: HEADER_SCRIPT_DENY }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'genia-works 키 저장소 검사에 실패해 이 도구 호출을 막았습니다' }))

  // 마지막 안전망 — 키·토큰 모양이 든 프롬프트는 모델·기록에 닿기 전에 막는다(drop 사유는 사람에게 보인다).
  // 슬래시 명령(e.command)도 같은 검사를 한다: drop 은 스킬·프롬프트 명령과 모델을 부르는 내장 명령을 막는다.
  // 모델에 가지 않는 로컬 내장 명령과 command.run 에서 끝나는 명령은 prompt.submit 이 오지 않아 이 검사가 닿지 않는다.
  // 키 값은 사유·로그 어디에도 싣지 않는다. 핸들러가 실패하면 키 모양일 때만 막고 아니면 통과시킨다.
  on('prompt.submit', async ($, e, next) => {
    if (containsSecretKey(e.text)) return { drop: PROMPT_KEY_DROP }
    return next(e)
  }).catch(($, e, next) => (containsSecretKey(e.text) ? { drop: PROMPT_KEY_DROP } : next(e)))
}
