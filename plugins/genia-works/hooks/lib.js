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

// 상태 줄 문구 — 헤더 스크립트와 같은 우선순위(세션 선택 > GENIA_WORKS_AS > 환경변수 토큰 > 내 토큰).
// keyMissing: 고른 이름의 키 파일이 없는 경우. 이때 서버는 "Bearer invalid" 로 받아 오류 문구가 오해를 부르므로 여기서 바로 알린다(판정 3).
export function identityLabel({ selected, as, hasEnvToken, keyMissing }) {
  const pick = selected || as
  if (pick && pick !== 'me') {
    return keyMissing ? `genia-works: ${pick} 키가 없습니다 — ${COMMANDS.login}` : `genia-works: ${pick}`
  }
  return hasEnvToken ? 'genia-works: 환경변수 토큰' : 'genia-works: 내 토큰'
}

// 키 저장소(~/.genia-works) 경로가 든 도구 입력인지 — 대화로 키가 새지 않게 막는다(우회는 막지 못함, README 에 명시).
// 경로 뒤에 올 수 있는 구분자: 경로 구분·끝·따옴표·공백·셸 연산자(;&|)<>).
export function isKeyPath(text) {
  return /\.genia-works(\/|\\|$|["'\s;&|)<>])/.test(text)
}

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
export function applyMaskedInput(real, _drawn, typed) {
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
