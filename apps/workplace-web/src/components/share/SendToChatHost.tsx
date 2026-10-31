// 「채팅·이슈로 보내기」 대화상자 호스트(WP-1235) — 앱 셸(AppLayout)에 한 번 두고, 어디서든 openSendToChat(target) 으로 연다.
// 🔗 복사 토스트의 단추처럼 React 트리 밖(토스트 콜백)에서도 열어야 해서, 열림 상태를 모듈 스토어(lib/sendToChat)로 두고 여기서 구독한다.
import { useSyncExternalStore } from 'react'

import { closeSendToChat, sendToChatSession, subscribeSendToChat } from '@/lib/sendToChat'

import { SendToChatDialog } from './SendToChatDialog'

export function SendToChatHost() {
  const session = useSyncExternalStore(subscribeSendToChat, sendToChatSession, sendToChatSession)
  // 열 때마다(세션마다) 새로 마운트해 고른 곳·쓴 말을 비운다. 닫기는 자기 세션만 닫는다 —
  // 보내는 사이 다른 대상으로 다시 열었으면, 늦게 끝난 앞 세션의 보내기가 새 창을 닫지 않는다.
  if (!session) return null
  return <SendToChatDialog key={session.id} target={session.target} onClose={() => closeSendToChat(session.id)} />
}
