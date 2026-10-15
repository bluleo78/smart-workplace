// genia-works mod — 세션별 접속 신원 선택(로그인 패널·전환·로그아웃), 신원 상태 줄, 키 파일 읽기 차단,
// 기존 수동 등록 정리. 토큰 주입은 하지 않는다(헤더 스크립트 담당 — 플러그인 MCP 가 mod 보다 먼저 연결된다).
// 규칙: $ 를 쓰는 코드는 모두 이 파일 안에 둔다(다른 파일 함수에 $ 를 넘기면 검증이 실패). lib.js 는 순수 함수만.
import { COMMANDS, parseKeyList, identityLabel, isKeyPath, toolTargets, END_CLEARS, applyMaskedInput, maskOf, initializeBody, validName, validKey, findManualRegistrations, isAiKeyRegistration, isHeaderScriptCall, HEADER_SCRIPT_DENY, sameServer, isHeadless, HEADLESS_SWITCH, HEADLESS_LOGIN } from './lib.js'

const SERVER = 'plugin:genia-works:genia-works'
let opts = {}
// 대화형 여부 — session.start 가 알려 준다(모르면 undefined → 대화형으로 본다). 명령의 origin 과 함께 isHeadless 로 판정.
let interactive

// 플러그인 scripts/ 의 sh 스크립트 실행 — 키 저장소·세션 선택 파일은 스크립트만 다룬다(원자적 교체·권한 규칙을 한곳에).
async function script($, name, args, stdin) {
  const init = stdin === undefined ? {} : { stdin }
  return $.process.run([$.plugin.root + '/scripts/' + name, ...args], init)
}

// 지금 이 세션의 신원 문구 — 상태 줄과 as(인자 없음)가 같은 입력으로 같은 문구를 얻는다.
// 고른 이름의 키가 없으면 그 사실을 직접 보이고, 내 토큰이 어디에도 없으면 설정 안내를 보인다.
async function currentLabel($) {
  const shown = await script($, 'gw-session', ['show'])
  const selected = shown.exitCode === 0 ? shown.stdout.trim() : ''
  const as = await $.env.get('GENIA_WORKS_AS')
  const envToken = await $.env.get('GENIA_WORKS_TOKEN')
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
  const list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  const label = await currentLabel($)
  const names = list.length ? list.map((k) => k.name).join(', ') : '(없음)'
  return `현재: ${label} · 등록된 AI: ${names}`
}

const PANE = 'genia-works-login'
// 패널 상태 — keyBuf(실제 키)는 저장 성공·실패, 검증·확인 실패, 화면 이동(go·키 바꾸기), 패널 닫기에서 비운다
// (덮어쓰기 확인 단계만 같은 키로 다시 누르도록 남긴다). 화면에는 maskOf(keyBuf)만 그린다.
// attempt: 열기·이동·닫기마다 올라가는 번호 — 서버 확인 중에 화면이 바뀌었으면 늦게 온 저장을 버린다.
let attempt = 0
let pane = { view: 'pick', list: [], current: '', envToken: false, keyBuf: '', name: '', message: '', confirm: '', busy: false }

// 패널 열기 — 등록된 AI 가 없으면 바로 「새 AI 추가」 화면으로 간다.
async function openLogin($) {
  const list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  // 현재 신원 — 세션 선택이 없으면 GENIA_WORKS_AS 가 가리키는 이름을 현재로 본다(헤더 스크립트와 같은 우선순위)
  const current = (await script($, 'gw-session', ['show'])).stdout.trim() || ((await $.env.get('GENIA_WORKS_AS')) ?? '')
  attempt++
  const envToken = Boolean(await $.env.get('GENIA_WORKS_TOKEN'))
  pane = { view: list.length ? 'pick' : 'add', list, current, envToken, keyBuf: '', name: '', message: '', confirm: '', busy: false }
  await $.ui.open({ id: PANE, title: 'genia-works 로그인', focus: true, closeOnEscape: true })
  // 다시 열 때 엔진이 지난 그림(settled)을 재사용하므로, 새 상태로 다시 그리라고 요청한다(안 하면 지난 화면이 남는다).
  $.ui.invalidate('ui.render')
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

// 새 키 저장 — 이름·형식 검사 → (덮어쓰기면 한 번 더 확인) → 서버 확인 → gw-keys add(stdin).
// 저장 성공·실패와 검증 실패에서는 keyBuf 를 비운다(키를 메모리에 오래 두지 않는다). 덮어쓰기 확인 단계만 같은 키로 다시 누르도록 남긴다.
// 진행 중(busy)에는 다시 눌러도 무시한다.
async function saveNewKey($) {
  if (pane.busy) return
  pane.busy = true
  try {
    await saveNewKeyInner($)
  } finally {
    pane.busy = false
  }
}

async function saveNewKeyInner($) {
  const key = pane.keyBuf.trim()
  const name = pane.name.trim()
  const fail = (m) => { pane.keyBuf = ''; pane.message = m }
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
  if (r.exitCode !== 0) return void (pane.message = '저장하지 못했습니다: ' + r.stderr.trim())
  pane.view = 'saved'
  pane.name = name
  pane.message = `✓ ${name} 키를 확인하고 저장했습니다. 지금 이 AI 로 바꿀까요?`
}

// 패널 닫기 — 플러그인이 스스로 닫을 때는 자기 ui.close 처리기가 불리지 않으므로 여기서 키를 먼저 비운다.
// (사람이 Esc 로 닫는 경우는 아래 ui.close 처리기가 비운다.)
async function closePane($) {
  attempt++
  pane.keyBuf = ''
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
    const sel = (await script($, 'gw-session', ['show'])).stdout.trim()
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
  pane.list = parseKeyList((await script($, 'gw-keys', ['list'])).stdout)
  pane.confirm = ''
  pane.message = `${name} 키를 지웠습니다` + note
  if (!pane.list.length) pane.view = 'add'
}

// 패널 트리 — view 별(pick·add·saved·manage). 상태가 바뀌면 invalidate 로 다시 그린다.
function renderPane($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const redraw = () => $.ui.invalidate('ui.render')
  const go = (view) => () => { attempt++; pane.view = view; pane.keyBuf = ''; pane.message = ''; pane.confirm = ''; redraw() }
  const msg = pane.message ? h(Text, null, pane.message) : null
  let body
  if (pane.view === 'pick') {
    body = [
      h(Text, null, '이 세션을 어느 신원으로 쓸까요?'),
      h(Button, { key: 'gw-pick-me', label: '내 토큰' + (pane.envToken ? ' (환경변수 GENIA_WORKS_TOKEN)' : '') + (pane.current === '' || pane.current === 'me' ? '  (현재)' : ''), onPress: async () => { await pickAndClose($, 'me') } }),
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
        onSubmit: async () => { await saveNewKey($); redraw() },
      }),
      h(Input, {
        key: 'gw-name', label: '이름', placeholder: '이 AI 의 아이디', value: pane.name, submitLabel: '확인하고 저장',
        onInput: (v) => { pane.name = v; redraw() },
        onSubmit: async () => { await saveNewKey($); redraw() },
      }),
      msg,
      h(Text, { dimColor: true }, `터미널에서 넣으려면: "${$.plugin.root}/scripts/gw-set-key" ${pane.name.trim() || '<이름>'}`),
      pane.list.length ? h(Button, { key: 'gw-back', label: '← 돌아가기', onPress: go('pick') }) : null,
      h(Button, { key: 'gw-cancel', label: '취소', onPress: async () => { await closePane($) } }),
    ]
  } else if (pane.view === 'saved') {
    body = [
      msg,
      h(Button, { key: 'gw-switch-now', label: '바꾸기', autoFocus: true, onPress: async () => { await pickAndClose($, pane.name) } }),
      h(Button, { key: 'gw-later', label: '나중에', onPress: async () => { await closePane($) } }),
    ]
  } else {
    body = [
      h(Text, null, '등록된 AI 관리'),
      ...pane.list.flatMap((k) => [
        h(Text, { key: 'gw-name-' + k.name }, `${k.name}  등록 ${k.added}`),
        h(Button, { key: 'gw-rekey-' + k.name, label: `${k.name} 키 바꾸기`, onPress: () => { attempt++; pane.view = 'add'; pane.name = k.name; pane.keyBuf = ''; pane.message = ''; pane.confirm = ''; redraw() } }),
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

// 기존 수동 등록 자동 정리(2026-10-15 사용자 결정) — 같은 주소에 사람이 손으로 등록한 서버가 있으면
// Claude Code 가 플러그인 서버를 가려 버린다. 플러그인 토큰으로 접속 확인을 통과하면 그 등록을 지우고 알린다.
// 세션 시작당 한 번만, 이미 도는 중이면 다시 시작하지 않는다.
let cleanupStarted = false
let cleanupRunning = false

// 옛 설정(f.config)에는 예전 수동 토큰이 들어 있을 수 있다 — 되살리기용으로 이 함수 안 변수에만 두고 로그·토스트에 쓰지 않는다.
async function cleanupManual($) {
  if (cleanupStarted || cleanupRunning) return
  cleanupStarted = true
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
    cfg = JSON.parse(await $.fs.read(home + '/.claude.json'))
  } catch {
    return // ~/.claude.json 이 없거나 읽을 수 없으면 정리할 것이 없다
  }
  const root = await $.session.root()
  const all = findManualRegistrations(cfg, root, opts.server_url)
  await warnProjectMcp($, root)
  // AI 키(Bearer ak_)로 연결된 등록은 지우지 않는다 — 지우면 그 프로젝트가 사람 신원으로 바뀌고 키도 잃는다. 키 값은 알리지 않는다.
  const found = all.filter((f) => !isAiKeyRegistration(f.config))
  const kept = all.filter((f) => isAiKeyRegistration(f.config))
  for (const f of kept) {
    $.ui.toast(`기존 genia-works 등록(${f.name})은 AI 키로 연결돼 있어 그대로 둡니다 — 이 키를 ${COMMANDS.login} 으로 등록한 뒤 claude mcp remove ${f.name} -s ${f.scope} 로 지우세요`, { timeoutMs: 12000 })
  }
  if (found.length === 0) return
  if (!opts.token) {
    $.ui.toast('기존 genia-works 등록이 있습니다 — /plugin › genia-works › 설정에 내 토큰을 넣으면 정리합니다', { timeoutMs: 10000 })
    return
  }
  // 플러그인 토큰이 서버에 통하는지 먼저 확인 — 통하지 않는데 지우면 연결이 둘 다 끊긴다.
  if (await verifyKey($, opts.token)) {
    $.ui.toast('플러그인 토큰으로 접속하지 못했습니다 — 기존 등록을 그대로 둡니다', { timeoutMs: 10000 })
    return
  }
  // 되살리기 — 이미 지운 항목을 원래 설정으로 다시 등록한다. 하나라도 실패하면 false.
  // 주의: 옛 설정(토큰 포함 가능)이 잠시 명령 인자(argv)에 실린다 — add-json 이 JSON 을 인자로만 받아 피할 수 없다.
  const restore = async (done) => {
    let all = true
    for (const f of done) {
      try {
        const r = await $.process.run(['claude', 'mcp', 'add-json', f.name, JSON.stringify(f.config), '-s', f.scope], { cwd: root })
        if (r.exitCode !== 0) all = false
      } catch {
        all = false
      }
    }
    return all
  }
  const restoreToast = async (done, okText) => {
    const text = (await restore(done)) ? okText : '기존 등록을 되살리지 못했습니다 — 터미널에서 claude mcp add 로 다시 등록하세요'
    if (text) $.ui.toast(text, { timeoutMs: 12000 }) // okText 가 빈 문자열이면 성공 시 따로 알리지 않는다(뒤따르는 토스트가 있다)
  }
  const removed = []
  for (const f of found) {
    let r
    try {
      r = await $.process.run(['claude', 'mcp', 'remove', f.name, '-s', f.scope], { cwd: root })
    } catch {
      await restoreToast(removed, '')
      $.ui.toast(`claude 명령을 찾지 못해 기존 등록을 지우지 못했습니다 — 터미널에서 claude mcp remove ${f.name} -s ${f.scope} 를 실행하세요`, { timeoutMs: 12000 })
      return
    }
    if (r.exitCode !== 0) {
      await restoreToast(removed, '')
      $.ui.toast(`기존 등록 ${f.name} 을 지우지 못했습니다 — 터미널에서 claude mcp remove ${f.name} -s ${f.scope} 를 실행하세요`, { timeoutMs: 12000 })
      return
    }
    removed.push(f)
  }
  let connected = null
  try {
    const c = await $.mcp.connect('genia-works') // 이 플러그인 .mcp.json 의 서버 키
    // 세션이 아직 옛 수동 서버를 들고 있으면 connect 가 그 이름(≠SERVER)으로 답한다 — 옛 연결·옛 토큰이라 확인이 되지 않으므로 연결 안 됨으로 본다.
    if (c.isConnected && c.server === SERVER) connected = c.server
  } catch {}
  if (!connected) {
    // 연결이 안 돼도 되살리지 않는다 — 되살리면 수동 등록이 플러그인 서버를 계속 가린다(세션 시작마다 되풀이).
    // 위 토큰 확인이 이 서버가 플러그인 토큰을 받아들임을 이미 보였으므로, 다음 시작부터는 플러그인 연결이 선다.
    // AI 키 등록을 남겨 두었다면 그것이 계속 플러그인 연결을 가리므로 「다시 시작하면 바뀝니다」를 약속하지 않는다.
    $.ui.toast(
      kept.length
        ? `기존 genia-works 수동 등록을 지웠습니다 — 남겨 둔 AI 키 등록(${kept.map((f) => f.name).join(', ')})을 지운 뒤 다시 시작해야 플러그인 연결로 바뀝니다`
        : '기존 genia-works 수동 등록을 지웠습니다 — 이 세션은 다시 시작하면 플러그인 연결로 바뀝니다',
      { timeoutMs: 12000 },
    )
    return
  }
  let ok = false
  try {
    const res = await $.mcp.call(connected, 'list_projects', {}) // 읽기 전용·인자 없음
    ok = !res?.isError
  } catch {}
  if (!ok) {
    // 플러그인 연결인데 도구가 안 돈다 — 확인할 수 없는 상태로 둘 수 없어 원래 등록으로 되돌린다.
    await restoreToast(removed, '플러그인 연결 확인에 실패해 기존 등록을 되살렸습니다')
    return
  }
  const scopes = [...new Set(removed.map((f) => (f.scope === 'user' ? '사용자 범위' : '이 프로젝트')))].join('·')
  $.ui.toast(`기존 genia-works 수동 등록(${scopes})을 지우고 플러그인 연결로 바꿨습니다. 이미 떠 있는 다른 세션은 다시 시작하면 바뀝니다.`, { timeoutMs: 12000 })
  await refreshStatus($)
}

// 프로젝트 .mcp.json(커밋 파일)에 같은 서버가 있으면 경고만 — 자동으로 고치지 않는다.
async function warnProjectMcp($, root) {
  try {
    const p = JSON.parse(await $.fs.read(root + '/.mcp.json'))
    const hit = Object.values(p?.mcpServers ?? {}).some((c) => c?.url && sameServer(c.url, opts.server_url))
    if (hit) $.ui.toast('이 프로젝트 .mcp.json 의 genia-works 등록이 플러그인 연결을 가립니다 — 그 항목을 지우세요', { timeoutMs: 10000 })
  } catch {
    // .mcp.json 없음 — 할 일 없음
  }
}

export function register(on, options) {
  opts = options ?? {}

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    try {
      await refreshStatus($)
    } catch {} // 스크립트 실패는 상태 줄만 건너뛰고 세션 시작은 막지 않는다
    // 수동 등록 정리 — 시작을 막지 않게 타이머로 미루고, 실패는 삼킨다. 세션 시작마다 한 번 다시 허용한다.
    cleanupStarted = false
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
      attempt++ // 진행 중인 서버 확인이 있어도 늦게 와서 저장하지 않게(closePane 과 같다)
      pane.keyBuf = ''
    }
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
    // 헤더 스크립트는 활성 키를 출력하므로 모델이 직접 돌리지 못하게 한다(gw-set-key 는 키를 출력하지 않아 허용).
    if (isHeaderScriptCall(e)) return { deny: HEADER_SCRIPT_DENY }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'genia-works 키 저장소 검사에 실패해 이 도구 호출을 막았습니다' }))
}
