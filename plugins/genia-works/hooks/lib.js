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
// drawn: 지난번 그린 ●…, typed: 사람이 고친 뒤 필드 내용. 반환: 새 실제 값.
export function applyMaskedInput(real, drawn, typed) {
  if (typed === '') return ''
  const bullets = typed.replace(/[^●]/g, '').length
  const fresh = typed.replace(/●/g, '')
  if (bullets === 0) return fresh // 전체를 바꿔 붙여넣음
  if (typed.startsWith(drawn)) return real + typed.slice(drawn.length) // 끝에 치기·붙여넣기
  if (fresh === '' && bullets < real.length) return real.slice(0, bullets) // 지우기(끝에서)
  // 중간 편집 — ● 가 아닌 글자를 그 위치(앞의 ● 개수)에 끼운다
  const at = typed.indexOf(fresh[0])
  return real.slice(0, at) + fresh + real.slice(at)
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
