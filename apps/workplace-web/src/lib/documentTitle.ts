// 브라우저 탭 제목(document.title) 규칙 — WP-814.
// 형식은 「{항목} · {화면} · Gen:iA Works」: 탭이 좁아도 앞쪽 글자로 구분되고, 공개 노트 공유 페이지와 같은 모양이다.

/** 탭 제목 끝에 붙는 앱 이름. */
export const APP_TITLE = 'Gen:iA Works'

/** 제목 조각 — 비었거나 거짓 값인 조각은 건너뛴다(로딩 중 이름이 아직 없을 때 등). */
export type TitlePart = string | null | undefined | false

/** 조각들을 「 · 」로 잇고 앱 이름을 붙인다. 조각이 모두 비면 앱 이름만. */
export function formatDocumentTitle(parts: readonly TitlePart[]): string {
  const filled = parts.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p) => p.length > 0)
  return [...filled, APP_TITLE].join(' · ')
}

// 설정 하위 화면 이름 — SettingsSidebar 의 메뉴 이름과 같게 둔다.
const SETTINGS_TITLES: Record<string, string> = {
  profile: '프로필',
  mail: '메일 계정',
  notifications: '알림',
  assistant: 'AI 비서',
  tokens: 'API 토큰',
  'my-shares': '내 공유',
  users: '구성원',
  agents: '에이전트',
  roles: '역할',
  sso: 'SSO',
  'audit-logs': '감사 로그',
}

// 설정 › 앱 설정 하위 화면 이름(WP-887) — /settings/apps/{앱}. 사이드바 「앱 설정」 항목 이름과 같게 둔다.
const SETTINGS_APP_TITLES: Record<string, string> = {
  work: '작업 관리',
  wiki: '노트',
}

/**
 * 주소만으로 정하는 화면 이름 조각 — 항목 이름(이슈·채널·노트 등)을 모르는 기본값이다.
 * 항목을 연 화면은 useDocumentTitle 로 이 값을 덮는다. 모르는 주소면 빈 배열(앱 이름만).
 * 이름은 사이드 레일·2차 사이드바의 메뉴 이름과 같게 둔다.
 */
export function routeTitleParts(pathname: string): string[] {
  const seg = pathname.split('/').filter(Boolean)
  const [first, second, third] = seg
  switch (first) {
    case undefined:
      return ['홈']
    case 'login':
      return ['로그인']
    case 'signup':
      return ['회원가입']
    case 'notifications':
      return ['알림']
    case 'apps':
      return ['앱']
    case 'tasks':
    case 'projects':
      return ['작업 관리']
    case 'me':
      if (second === 'ai-tasks') return ['AI 위임 작업']
      return ['내 작업']
    case 'chat':
      if (second === 'new') return ['새 메시지', '대화']
      if (second === 'threads') return ['스레드', '대화']
      return ['대화']
    case 'mail':
      return ['메일']
    case 'calendar':
      return ['캘린더']
    case 'drive':
      if (second === 'attachments') return ['첨부 모아보기', '드라이브']
      return ['드라이브']
    case 'wiki':
      return ['노트']
    case 'contacts':
      return ['연락처']
    case 'settings': {
      const sub = second === 'apps' ? (third ? SETTINGS_APP_TITLES[third] : undefined) : second ? SETTINGS_TITLES[second] : undefined
      return sub ? [sub, '설정'] : ['설정']
    }
    default:
      return []
  }
}
