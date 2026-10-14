// genia-works mod — 세션별 접속 신원 선택(로그인 패널·전환·로그아웃), 신원 상태 줄, 키 파일 읽기 차단,
// 기존 수동 등록 정리. 토큰 주입은 하지 않는다(헤더 스크립트 담당 — 플러그인 MCP 가 mod 보다 먼저 연결된다).
// 규칙: $ 를 쓰는 코드는 모두 이 파일 안에 둔다(다른 파일 함수에 $ 를 넘기면 검증이 실패). lib.js 는 순수 함수만.
import { COMMANDS, parseKeyList, identityLabel, isKeyPath, toolTargets, END_CLEARS, applyMaskedInput, maskOf, initializeBody, validName } from './lib.js'

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
  const list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  const shown = (await script($, 'gw-session', ['show'])).stdout.trim()
  const names = list.length ? list.map((k) => k.name).join(', ') : '(없음)'
  return `현재: ${shown || '기본'} · 등록된 AI: ${names}`
}

const PANE = 'genia-works-login'
// 패널 상태 — keyBuf(실제 키)는 저장·닫기 즉시 비운다. 화면에는 maskOf(keyBuf)만 그린다.
let pane = { view: 'pick', list: [], current: '', keyBuf: '', name: '', message: '', confirm: '' }

// 패널 열기 — 등록된 AI 가 없으면 바로 「새 AI 추가」 화면으로 간다.
async function openLogin($) {
  const list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  const current = (await script($, 'gw-session', ['show'])).stdout.trim()
  pane = { view: list.length ? 'pick' : 'add', list, current, keyBuf: '', name: '', message: '', confirm: '' }
  await $.ui.open({ id: PANE, title: 'genia-works 로그인', focus: true, closeOnEscape: true })
}

// 키 확인 — 그 키로 initialize 를 보내 401 이면 거절. 네트워크 오류는 저장하지 않고 알린다.
async function verifyKey($, key) {
  try {
    const r = await $.http.fetch(opts.server_url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: initializeBody(),
    })
    if (r.status === 401) return '키가 맞지 않습니다(만료·회수 여부를 확인하세요)'
    if (!r.ok) return '서버 확인에 실패했습니다: HTTP ' + r.status
    return ''
  } catch (err) {
    return '서버에 접속하지 못했습니다: ' + String(err)
  }
}

// 새 키 저장 — 이름·형식 검사 → (덮어쓰기면 한 번 더 확인) → 서버 확인 → gw-keys add(stdin). 성공·실패 모두 keyBuf 는 비운다.
async function saveNewKey($) {
  const key = pane.keyBuf
  const name = pane.name.trim()
  if (!validName(name)) return void (pane.message = '이름은 영문·숫자·._@- 만 쓸 수 있습니다(me 는 예약)')
  if (key.startsWith('swp_')) return void (pane.message = '내 토큰(swp_)은 /plugin › genia-works › 설정에 넣으세요')
  if (!key.startsWith('ak_')) return void (pane.message = 'AI 키는 ak_ 로 시작합니다')
  if (pane.list.some((k) => k.name === name) && pane.confirm !== 'overwrite-' + name) {
    pane.confirm = 'overwrite-' + name
    return void (pane.message = `${name} 키를 바꿀까요? 한 번 더 저장을 누르면 바꿉니다`)
  }
  pane.message = '확인 중…'
  $.ui.invalidate('ui.render')
  const bad = await verifyKey($, key)
  if (bad) return void (pane.message = bad)
  const r = await script($, 'gw-keys', ['add', name], key + '\n')
  pane.keyBuf = ''
  if (r.exitCode !== 0) return void (pane.message = '저장하지 못했습니다: ' + r.stderr.trim())
  pane.view = 'saved'
  pane.name = name
  pane.message = `✓ ${name} 키를 확인하고 저장했습니다. 지금 이 AI 로 바꿀까요?`
}

// 신원 전환 후 패널 닫기 — 결과 문장은 토스트로도 보인다.
async function pickAndClose($, name) {
  pane.message = await switchTo($, name)
  $.ui.toast(pane.message)
  await $.ui.close({ id: PANE })
}

// 키 삭제 — 지금 쓰는 이름이면 세션 선택부터 풀고 다시 연결한 뒤 지운다. 이후 목록을 다시 읽는다.
async function removeKey($, name) {
  if (pane.current === name) {
    await script($, 'gw-session', ['clear'])
    reconnectSoon($)
    pane.current = ''
  }
  await script($, 'gw-keys', ['remove', name])
  pane.list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  pane.confirm = ''
  pane.message = `${name} 키를 지웠습니다`
  if (!pane.list.length) pane.view = 'add'
}

// 패널 트리 — view 별(pick·add·saved·manage). 상태가 바뀌면 invalidate 로 다시 그린다.
function renderPane($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const redraw = () => $.ui.invalidate('ui.render')
  const go = (view) => () => { pane.view = view; pane.message = ''; pane.confirm = ''; redraw() }
  const msg = pane.message ? h(Text, null, pane.message) : null
  let body
  if (pane.view === 'pick') {
    body = [
      h(Text, null, '이 세션을 어느 신원으로 쓸까요?'),
      h(Button, { key: 'gw-pick-me', label: '내 토큰' + (pane.current === '' || pane.current === 'me' ? '  (현재)' : ''), onPress: async () => { await pickAndClose($, 'me') } }),
      ...pane.list.map((k) =>
        h(Button, { key: 'gw-pick-' + k.name, label: `${k.name}  등록 ${k.added}` + (pane.current === k.name ? '  (현재)' : ''), onPress: async () => { await pickAndClose($, k.name) } })),
      h(Button, { key: 'gw-add', label: '＋ 새 AI 추가', onPress: go('add') }),
      h(Button, { key: 'gw-manage', label: '등록된 AI 관리…', onPress: go('manage') }),
      msg,
    ]
  } else if (pane.view === 'add') {
    body = [
      h(Input, {
        key: 'gw-key', label: 'AI 키', placeholder: '관리자 › 에이전트에서 발급한 ak_ 키', value: maskOf(pane.keyBuf), autoFocus: true,
        onInput: (v) => { pane.keyBuf = applyMaskedInput(pane.keyBuf, maskOf(pane.keyBuf), v); redraw() },
        onSubmit: () => {},
      }),
      h(Input, {
        key: 'gw-name', label: '이름', placeholder: '이 AI 의 아이디', value: pane.name, submitLabel: '확인하고 저장',
        onInput: (v) => { pane.name = v },
        onSubmit: async () => { await saveNewKey($); redraw() },
      }),
      msg,
      h(Text, { dimColor: true }, `터미널에서 넣으려면: "${$.plugin.root}/scripts/gw-set-key" ${pane.name.trim() || '<이름>'}`),
      pane.list.length ? h(Button, { key: 'gw-back', label: '← 돌아가기', onPress: go('pick') }) : null,
    ]
  } else if (pane.view === 'saved') {
    body = [
      msg,
      h(Button, { key: 'gw-switch-now', label: '바꾸기', onPress: async () => { await pickAndClose($, pane.name) } }),
      h(Button, { key: 'gw-later', label: '나중에', onPress: async () => { await $.ui.close({ id: PANE }) } }),
    ]
  } else {
    body = [
      h(Text, null, '등록된 AI 관리'),
      ...pane.list.flatMap((k) => [
        h(Text, { key: 'gw-name-' + k.name }, `${k.name}  등록 ${k.added}`),
        h(Button, { key: 'gw-rekey-' + k.name, label: `${k.name} 키 바꾸기`, onPress: () => { pane.view = 'add'; pane.name = k.name; pane.message = ''; pane.confirm = ''; redraw() } }),
        h(Button, { key: 'gw-remove-' + k.name, label: `${k.name} 삭제`, onPress: () => { pane.confirm = 'remove-' + k.name; redraw() } }),
        pane.confirm === 'remove-' + k.name
          ? h(Box, { flexDirection: 'column' },
              h(Text, null, `${k.name} 키를 이 컴퓨터에서 지울까요?`),
              h(Button, { key: 'gw-remove-confirm-' + k.name, label: '지우기', onPress: async () => { await removeKey($, k.name); redraw() } }))
          : null,
      ]),
      msg,
      h(Button, { key: 'gw-back', label: '← 돌아가기', onPress: go(pane.list.length ? 'pick' : 'add') }),
    ]
  }
  return h(Box, { flexDirection: 'column' }, ...body.filter(Boolean))
}

export function register(on, options) {
  opts = options ?? {}

  on('session.start', async ($, e, next) => {
    try {
      await refreshStatus($)
    } catch {} // 스크립트 실패는 상태 줄만 건너뛰고 세션 시작은 막지 않는다
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

  // 로그인 패널 — 명령으로 열고, 그리기는 이 패널 id 만 맡는다(다른 패널은 그대로 넘긴다).
  on('command.run', { command: 'genia-works:login' }, async ($) => {
    await openLogin($)
    return {}
  }).catch(() => ({ text: '로그인 패널을 열지 못했습니다. 잠시 뒤 다시 시도하세요' }))

  on('ui.render', { component: 'Pane' }, ($, e, next) => (e.requestId !== PANE ? next(e) : renderPane($, e)))

  // 패널이 닫히면 입력해 둔 키를 즉시 비운다.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) pane.keyBuf = ''
    return next(e)
  })

  // 세션 끝 — 종료·로그아웃일 때만 선택을 지운다. 예산 1.5초라 파일 하나만 지운다.
  on('session.end', async ($, e, next) => {
    if (END_CLEARS.has(e.reason)) await script($, 'gw-session', ['clear'])
    return next(e)
  })

  // 키 저장소 읽기 차단 — 키가 대화(기록·모델 입력)로 들어가지 않게 한다. 핸들러가 실패해도 막는 쪽으로 닫는다(판정 4).
  on('tool.call', async ($, e, next) => {
    if (toolTargets(e).some(isKeyPath)) {
      return { deny: 'genia-works 키 저장소(~/.genia-works)는 열 수 없습니다. 신원 확인은 ' + COMMANDS.as + ' 를 쓰세요.' }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'genia-works 키 저장소 검사에 실패해 이 도구 호출을 막았습니다' }))
}
