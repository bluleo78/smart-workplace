// 반응(이모지) 공용 컴포넌트의 주입 타입 — 채팅 메시지·이슈 코멘트가 같은 칩·호버 카드·반응자 목록을 쓰도록
// "무엇에 달린 반응인지(대상)"와 "반응자를 어디서 가져오는지(소스)"를 밖에서 넘긴다.
// (컴포넌트 파일과 분리 — react-refresh 규칙: 컴포넌트 파일은 컴포넌트만 export.)
import type { ReactionResponse, ReactorPage } from '@/types/messaging'

export type { ReactionResponse, ReactorPage }

/** 반응자 목록을 어디서 가져올지 — 채팅 메시지·이슈 코멘트가 각자 주입한다. */
export interface ReactorSource {
  /** TanStack Query 키 접두사(이모지·커서는 훅이 덧붙인다). 반응 변경 시 이 접두사로 무효화한다. */
  queryKey: readonly unknown[]
  /** 이모지 하나의 반응자 한 페이지. cursor 가 null 이면 첫 페이지. */
  fetchPage: (emoji: string, cursor: string | null) => Promise<ReactorPage>
}

/** 반응 대상(메시지·코멘트) — id 와 집계만 있으면 된다. */
export interface ReactionTarget {
  id: number
  reactions: ReactionResponse[]
}
