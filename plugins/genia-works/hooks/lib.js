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
export function isKeyPath(text) {
  return /\.genia-works(\/|\\|$|["'\s])/.test(text)
}

// 세션 선택을 지우는 종료 사유 — /clear·/resume 은 같은 프로세스가 계속 돌아 지우면 연결과 어긋난다.
export const END_CLEARS = new Set(['prompt_input_exit', 'logout', 'other'])
