// 공유 링크 토큰 컨텍스트(WP-579) — 공유 화면(/wiki/share/:token) 아래의 훅·NodeView 가 지금 토큰을 읽는다.
// 멘션 해소·이미지 blob·제목 저장·이미지 업로드는 화면 깊숙한 곳에서 API 를 부르는데, 그곳까지 토큰을 props 로 내리지 않고
// 여기서 읽어 api/wiki.ts 의 shareHeaders(token) 로 헤더를 만든다. 공유 화면이 아니면 undefined — 지금과 똑같이 동작한다.

import { createContext, type ReactNode, useContext } from 'react'

const WikiShareTokenContext = createContext<string | undefined>(undefined)

/**
 * 공유 토큰을 하위에 내려 준다. 에디터 NodeView(이미지·멘션 칩)는 포털로 그려지지만 React 트리는 이어지므로
 * EditorContent 를 감싸면 NodeView 도 이 값을 받는다.
 */
export function WikiShareTokenProvider({ token, children }: { token: string | undefined; children: ReactNode }) {
  return <WikiShareTokenContext.Provider value={token}>{children}</WikiShareTokenContext.Provider>
}

/** 지금 공유 화면의 토큰 — 공유 화면이 아니면 undefined. */
// eslint-disable-next-line react-refresh/only-export-components
export function useWikiShareToken(): string | undefined {
  return useContext(WikiShareTokenContext)
}
