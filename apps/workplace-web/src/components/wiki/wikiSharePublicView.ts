// 공유 링크 입구의 외부 보기 전환(WP-579) — 로그인했지만 링크의 워크스페이스 멤버가 아닌 사람이 외부(PUBLIC) 링크를 열면
// 설계 「멤버가 아니면 외부 링크는 외부 보기」대로 비로그인과 같은 외부 보기를 그린다. 판정은 앱 셸 안 공유 화면(링크 열기 응답)이 하고,
// 앱 셸 밖 전체 화면으로 바꾸는 건 입구(App.tsx WikiShareGate)가 한다 — 그 사이를 잇는 신호.

import { createContext, useContext } from 'react'

/** 이 토큰은 외부 보기로 그리라고 입구에 알린다. 입구 밖(일반 노트 화면)에선 null. */
export const WikiSharePublicViewContext = createContext<((token: string) => void) | null>(null)

/** 공유 화면이 외부 보기로 바꿔 달라고 부르는 함수 — 입구 밖이면 null. */
export function useShowPublicShareView(): ((token: string) => void) | null {
  return useContext(WikiSharePublicViewContext)
}
