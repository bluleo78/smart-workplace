// HTML 블록 「AI로 고치기」(WP-1302) 컨텍스트 — 노트 편집기(WikiEditor)가 이 노트의 AI 사용 조건을 블록 NodeView 에 내려 준다.
// NodeView 는 확장 묶음(wikiRenderExtensions)으로 편집기·판 미리보기·공개 공유에서 함께 쓰여 props 로 페이지 id 를 받을 수 없다 —
// 포털로 그려져도 React 트리는 이어지므로(WikiShareTokenContext 와 같은 방식) EditorContent 를 감싼 값이 블록까지 닿는다.
import { createContext, type ReactNode, useContext } from 'react'

export interface WikiHtmlEmbedAi {
  /** AI 요청을 보낼 노트 페이지 id. */
  pageId: number
  /**
   * AI 결과를 문서에 넣는다 — 편집기의 AI 넣기와 같은 길(동기화 서버 ai-apply 핸드셰이크 뒤 insert)이라 판 기록에 ✦ 로 남는다.
   * 넣었으면 true, 그사이 편집할 수 없게 됐으면(권한 강등·편집기 사라짐) 넣지 않고 false.
   * signal 이 끊기면(칸을 닫음·블록이 내려감) ack 를 기다리던 중이어도 넣지 않는다 — 닫은 뒤에 블록이 바뀌지 않게.
   */
  commit: (insert: () => void, signal?: AbortSignal) => Promise<boolean>
  /** 결과를 받았을 때 — 헤더 「AI 생성 포함」 배지를 맞추려 페이지를 다시 읽는다(서버가 스트림 완료에 기록한다). */
  onResult?: () => void
}

const Ctx = createContext<WikiHtmlEmbedAi | null>(null)

/** AI 를 쓸 수 있는 노트 편집 화면에서만 감싼다 — 없으면(판 미리보기·공개 공유·AI 권한 없음) 「AI로 고치기」 단추가 없다. */
export function WikiHtmlEmbedAiProvider({ value, children }: { value: WikiHtmlEmbedAi | null; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 지금 화면의 HTML 블록 AI 조건 — 쓸 수 없으면 null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useWikiHtmlEmbedAi(): WikiHtmlEmbedAi | null {
  return useContext(Ctx)
}
