// 메시지 작업 시트 열림 상태 — 목록(팀 채팅 MessageList·이슈 채팅 ChatMessageList)마다 시트 하나를 두고 대상 id 만 바꾼다.
// 대상 id 는 닫을 때 지우지 않는다 — 닫힘 애니메이션 동안 시트 내용이 비어 보이지 않게 열림 여부만 따로 둔다.
// 대상은 id 로만 들고 최신 목록에서 찾는다 — 열린 동안 반응·수정이 실시간 반영돼도 낡은 객체를 쓰지 않는다.
import { useCallback, useState } from 'react'

export function useMessageSheet<T extends { id: number }>(items: T[]) {
  const [state, setState] = useState<{ id: number; open: boolean } | null>(null)
  const target = state ? items.find((m) => m.id === state.id) : undefined
  const show = useCallback((id: number) => setState({ id, open: true }), [])
  const close = useCallback(() => setState((s) => (s ? { ...s, open: false } : s)), [])
  // 대상이 목록에서 사라지면(삭제·채널 이동) 열림 표식이 남아 있어도 닫힌 것으로 본다.
  return { target, open: !!state?.open && target !== undefined, show, close }
}
