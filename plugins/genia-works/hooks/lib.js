// genia-works mod 의 순수 함수 — $(mods API)를 쓰지 않아 node --test 로 따로 검증한다.

// 사용자에게 보이는 명령 표기 — 구현 전 실측(판정 8, A안: 명령 파일) 결과로 정한 한 곳. 웹 안내(pluginGuide.ts)도 같은 표기를 쓴다.
export const COMMANDS = { login: '/genia-works:login', as: '/genia-works:as', logout: '/genia-works:logout' }

// gw-keys list 출력("이름\tMM-DD" 줄들)을 목록으로.
export function parseKeyList(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, added = ''] = l.split('\t')
      return { name, added }
    })
}

// 이 세션이 고른 AI 이름(세션 선택 > GENIA_WORKS_AS), 내 토큰(me·선택 없음)이면 빈 문자열 — 신원 판단은 이 한 곳에 둔다.
export function aiPick({ selected, as }) {
  const pick = selected || as || ''
  return pick === 'me' ? '' : pick
}

// 신원 문구 — 앞의 플러그인 이름(genia-works)은 Claude Code 가 붙이므로 여기서는 쓰지 않는다(두 번 나오던 결함).
//  헤더 스크립트와 같은 우선순위(세션 선택 > GENIA_WORKS_AS > 환경변수 토큰 > 내 토큰).
// keyMissing: 고른 이름의 키 파일이 없는 경우. 이때 서버는 "Bearer invalid" 로 받아 오류 문구가 오해를 부르므로 여기서 바로 알린다(판정 3).
// hasToken: 내 토큰이 어디에도 없는지(환경변수·플러그인 설정 모두 비어 있음) — false 로 명시하면 안내 문구를 낸다(생략하면 있는 것으로 본다).
export function identityLabel({ selected, as, hasEnvToken, keyMissing, hasToken }) {
  const pick = aiPick({ selected, as })
  if (pick) {
    return keyMissing ? `${pick} 키가 없습니다 — ${COMMANDS.login}` : pick
  }
  if (hasEnvToken) return '환경변수 토큰'
  return hasToken === false ? `내 토큰 없음 — /plugin configure genia-works@genia-works` : '내 토큰'
}

// 상태 줄에 실을 문구 — AI 신원을 쓰는 중(키가 없는 경우 포함)일 때만 보이고, 그 밖에는 undefined 로 지운다(WP-403).
//  Claude Code 가 상태 줄을 ⚠·노란색으로 그려 평소 상태까지 경고처럼 보였다. 사용자 결정: AI 사용 중 말고는 상태 줄을 쓰지 않는다.
export function statusLabel(input) {
  return aiPick(input) ? identityLabel(input) : undefined
}

// 비대화형(claude -p·SDK) 판정 — 이런 세션에서는 연결을 다시 붙일 수 없고($.command.run 불가) 패널도 못 그린다.
// 신호 둘: session.start 의 isInteractive(false 면 -p/SDK) 또는 명령 origin.kind === 'sdk'(-p 가 실행한 명령).
// interactive 가 아직 모르면(undefined) 대화형으로 본다 — 모르는데 막으면 대화형 사용자가 전환을 못 한다.
export function isHeadless({ interactive, origin }) {
  return interactive === false || origin?.kind === 'sdk'
}

export const HEADLESS_SWITCH = '이 세션에서는 바꿀 수 없습니다 — 띄울 때 GENIA_WORKS_AS 로 지정하세요'
export const HEADLESS_LOGIN = '로그인 화면은 대화형 세션에서만 열 수 있습니다 — 띄울 때 GENIA_WORKS_AS 로 지정하세요'

// 키 저장소(~/.genia-works) 경로가 든 도구 입력인지 — 대화로 키가 새지 않게 막는다(우회는 막지 못함, README 에 명시).
// 경로 뒤에 올 수 있는 구분자: 경로 구분·끝·따옴표·공백·셸 연산자(;&|)<>).
export function isKeyPath(text) {
  if (!text.includes('.genia-works')) return false // 싼 선검사 — 대부분의 도구 입력은 여기서 끝난다
  return /\.genia-works(\/|\\|$|["'\s;&|)<>])/.test(text)
}

// 헤더 스크립트(gw-headers·gw-session-key)를 직접 실행하려는 Bash 명령인지 — gw-headers 는 활성 AI 키를 출력하므로 대화로 새게 된다.
// 명령 자리(맨 앞·줄바꿈·; & | ( ` $( 뒤, sh/bash/exec/env 같은 실행기·VAR=값 뒤)에 그 스크립트가 올 때만 실행으로 본다.
// cat·git diff·git add 처럼 인자로 이름만 나오는 명령은 막지 않는다(이 저장소에서 플러그인을 개발할 때 방해되지 않게).
// gw-set-key·gw-headers-x·my-gw-headers 는 해당 없음.
// 명령 자리 앞 구분자에 줄바꿈(\n·\r)을 포함한다 — 새 줄의 명령도 실행 자리다.
// 실행기 단어에 셸 키워드(then·do·else·elif·{·!·if·while·until)와 xargs 를 더해 `if x; then <스크립트>` 같은 자리도 잡는다(각각 뒤에 공백).
const CMD_POS = String.raw`(?:^|[;&|\n\r(\x60]|\$\()\s*(?:\w+=\S*\s+)*(?:(?:sh|bash|dash|zsh|ksh|exec|env|command|nohup|time|xargs|source|\.|then|do|else|elif|\{|!|if|while|until)\s+(?:-\S+\s+)*)*`
const HEADER_SCRIPT = String.raw`["']?(?:[^\s"';&|()<>\x60]*\/)?gw-(?:headers|session-key)["']?(?=$|[\s;&|)<>\x60])`
const HEADER_SCRIPT_CALL = new RegExp(CMD_POS + HEADER_SCRIPT)
export function isHeaderScriptCall(input) {
  const cmd = input && typeof input === 'object' ? input.command : undefined
  if (typeof cmd !== 'string') return false
  if (!cmd.includes('gw-headers') && !cmd.includes('gw-session-key')) return false // 싼 선검사 — 정규식은 이름이 보일 때만
  return HEADER_SCRIPT_CALL.test(cmd)
}

export const HEADER_SCRIPT_DENY = 'genia-works 헤더 스크립트는 직접 실행할 수 없습니다 — 신원 확인은 ' + COMMANDS.as

export const KEY_PATH_DENY = 'genia-works 키 저장소(~/.genia-works)는 열 수 없습니다. 신원 확인은 ' + COMMANDS.as + ' 를 쓰세요.'

// 도구 입력에서 경로·명령으로 쓰이는 필드의 문자열만 뽑는다 — 쓰는 내용(content·new_string 등)에 경로가 언급된 것까지 막지 않으려는 것.
const TARGET_FIELDS = ['file_path', 'path', 'notebook_path', 'pattern', 'glob', 'command']
export function toolTargets(input) {
  if (!input || typeof input !== 'object') return []
  return TARGET_FIELDS.map((k) => input[k]).filter((v) => typeof v === 'string')
}

// 세션 선택을 지우는 종료 사유 — /clear·/resume 은 같은 프로세스가 계속 돌아 지우면 연결과 어긋난다.
export const END_CLEARS = new Set(['prompt_input_exit', 'logout', 'other'])

// 가림 입력 — mod 의 Input 에는 가리기 옵션이 없어, 실제 값은 따로 들고 필드에는 ● 를 그린다(2026-10-15 결정).
// real: 지금까지의 실제 값, typed: 사람이 고친 뒤 필드 내용. 반환: 새 실제 값.
// 다시 그리기 전에 입력이 연달아 오면 필드에 방금 친 평문이 남아 있다 — 그 글자는 실제 값과 같은 글자이므로,
// 앞·뒤에서 「● 이거나 실제 글자와 같은」 구간을 공통 접두·접미로 보고 가운데(새로 바뀐 부분)만 typed 에서 가져온다.
// 피할 수 없는 모호함: 가운데 글자를 Backspace/Delete 로 지우면 끝에서 지운 것과 구별되지 않는다(키 확인에서 걸러진다).
export function applyMaskedInput(real, typed) {
  if (typed === '') return ''
  const same = (t, r) => t === '●' || t === r
  let p = 0
  while (p < typed.length && p < real.length && same(typed[p], real[p])) p++
  // 가운데(새로 바뀐 부분)에 ● 가 남으면 접두가 새로 친 글자를 삼킨 것(친 글자가 그 자리의 실제 글자와 같을 때) — 접두를 한 칸씩 물린다.
  for (;;) {
    const room = Math.min(typed.length, real.length) - p // 접두와 겹치지 않는 범위
    let s = 0
    while (s < room && same(typed[typed.length - 1 - s], real[real.length - 1 - s])) s++
    const middle = typed.slice(p, typed.length - s)
    if (p === 0 || !middle.includes('●')) return real.slice(0, p) + middle + real.slice(real.length - s)
    p--
  }
}

// 화면에 그릴 가림 문자열 — 실제 키 길이만큼 ● 이다.
export function maskOf(real) {
  return '●'.repeat(real.length)
}

// 키 확인용 MCP initialize — 게이트웨이가 /auth/me 로 조기 검증해 잘못된 키는 401 을 준다.
export function initializeBody() {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'genia-works-plugin', version: '0.1.0' } },
  })
}

// 이름 규칙 — scripts/gw-lib.sh 의 gw_valid_name 과 같다(예약 이름 me 도 거부).
export function validName(name) {
  return /^[A-Za-z0-9._@-]+$/.test(name) && name !== '.' && name !== '..' && name !== 'me'
}

// AI 키 형식 — 게이트웨이 헤더 스크립트가 받는 문자만(ak_ + 영숫자·_-).
export function validKey(key) {
  return /^ak_[A-Za-z0-9_-]+$/.test(key)
}

// 같은 genia-works 서버인지 — origin 이 같고 경로가 끝의 '/' 하나를 뗀 뒤 같을 때만 같은 서버로 본다(/mcp == /mcp/).
// /mcp/readonly·/mcp/x/issue·/mcpfoo 는 다른 서버다: 삭제는 되돌릴 수 없고, 가림은 같은 주소에서만 확인됐다.
export function sameServer(a, b) {
  try {
    const x = new URL(a)
    const y = new URL(b)
    const path = (u) => u.pathname.replace(/\/$/, '')
    return x.origin === y.origin && path(x) === path(y)
  } catch {
    return false
  }
}

// 원문에 서버 호스트가 글자로 나오는지 — 큰 JSON 을 파싱하기 전의 싼 선검사. 주소를 해석할 수 없으면 판단하지 않고 true(정상 경로로 이어 간다).
export function mentionsHost(raw, serverUrl) {
  try {
    return raw.toLowerCase().includes(new URL(serverUrl).host.toLowerCase())
  } catch {
    return true
  }
}

// ~/.claude.json 에서 이 플러그인을 가리는 수동 등록 찾기 — 사용자 범위(mcpServers)와 이 프로젝트의 로컬 범위.
// 프로젝트 .mcp.json(커밋되는 파일)은 여기서 다루지 않는다(경고만).
export function findManualRegistrations(claudeJson, projectRoot, serverUrl) {
  const out = []
  for (const [name, config] of Object.entries(claudeJson?.mcpServers ?? {})) {
    if (config?.url && sameServer(config.url, serverUrl)) out.push({ scope: 'user', name, config })
  }
  const local = claudeJson?.projects?.[projectRoot]?.mcpServers ?? {}
  for (const [name, config] of Object.entries(local)) {
    if (config?.url && sameServer(config.url, serverUrl)) out.push({ scope: 'local', name, config })
  }
  return out
}

// 수동 등록이 AI 키(Bearer ak_…)로 연결돼 있는지 — 이런 등록을 지우면 그 프로젝트의 신원이 사람으로 바뀌고 키도 잃는다.
// 헤더 이름은 대소문자를 가리지 않는다. 키 값은 돌려주지 않는다.
export function isAiKeyRegistration(config) {
  for (const [k, v] of Object.entries(config?.headers ?? {})) {
    if (k.toLowerCase() === 'authorization' && typeof v === 'string' && /bearer\s+ak_/i.test(v)) return true
  }
  return false
}

// 프롬프트에 든 genia-works 키·토큰 모양 — 내 토큰은 swp_, AI 키는 ak_ 뒤에 base62 32바이트(약 43자).
// 앞 글자는 보지 않는다 — URL 인코딩(%20swp_…)·JSON 이스케이프(\nak_…)처럼 영문·숫자 바로 뒤에 붙은 키도 잡기 위해서다.
// 대가로 받아들인 오탐: 이름이 ak·swp 로 끝나는 식별자 뒤에 영문·숫자 32자 이상이 오면(예: break_<32자+>, leak_<32자+>) 걸린다.
// 문서·테스트의 짧은 가짜(ak_FAKE_ABC123 등)는 32자 미만이라 걸리지 않는다.
export const KEY_LIKE = /(?:swp|ak)_[A-Za-z0-9]{32,}/

// 텍스트에 키·토큰 모양이 있으면 true — 키 값은 돌려주지 않는다(메시지·로그에 되울리지 않게).
export function containsSecretKey(text) {
  return typeof text === 'string' && (text.includes('ak_') || text.includes('swp_')) && KEY_LIKE.test(text) // 싼 선검사 — 정규식은 접두가 보일 때만
}
