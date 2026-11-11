// 노트 화면이 이동할 주소를 만드는 컨텍스트(WP-1481) — 노트 컴포넌트가 `/wiki/...` 를 직접 짓지 않고 여기서 읽는다.
// 같은 컴포넌트를 프로젝트 「노트」 탭(/projects/:key/notes[/:pageId]) 안에 올릴 때 Provider 로 주소 규칙만 바꿔 끼운다.
// Provider 가 없으면 기본(/wiki) — 노트 앱은 지금과 똑같이 동작한다.

import { createContext, type ReactNode, useContext } from 'react'

export type WikiRoutes = {
  /** 공간 목록(트리) 주소 */
  spacePath(spaceId: number): string
  /** 페이지 주소 */
  pagePath(spaceId: number, pageId: number): string
  /** 노트 홈(돌아가기 목적지) */
  homePath(): string
}

/** 노트 앱 기본 주소 규칙. */
// eslint-disable-next-line react-refresh/only-export-components
export const defaultWikiRoutes: WikiRoutes = {
  spacePath: (spaceId) => `/wiki/spaces/${spaceId}`,
  pagePath: (spaceId, pageId) => `/wiki/spaces/${spaceId}/pages/${pageId}`,
  homePath: () => '/wiki',
}

/**
 * 프로젝트 탭용 주소 규칙 — 프로젝트 공간(spaceId)은 base 아래로, 다른 공간(다른 곳의 노트 링크 등)은 기본 주소로 보낸다.
 * 탭 밖 공간을 탭 주소로 열면 공간이 맞지 않아 열리지 않기 때문.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function projectWikiRoutes(spaceId: number, base: string): WikiRoutes {
  return {
    spacePath: (s) => (s === spaceId ? base : defaultWikiRoutes.spacePath(s)),
    pagePath: (s, p) => (s === spaceId ? `${base}/${p}` : defaultWikiRoutes.pagePath(s, p)),
    homePath: () => base,
  }
}

const WikiRoutesContext = createContext<WikiRoutes>(defaultWikiRoutes)

/** 하위 노트 컴포넌트에 주소 규칙을 내려 준다. */
export function WikiRoutesProvider({ value, children }: { value: WikiRoutes; children: ReactNode }) {
  return <WikiRoutesContext.Provider value={value}>{children}</WikiRoutesContext.Provider>
}

/** 지금 주소 규칙 — Provider 가 없으면 기본(/wiki). */
// eslint-disable-next-line react-refresh/only-export-components
export function useWikiRoutes(): WikiRoutes {
  return useContext(WikiRoutesContext)
}
