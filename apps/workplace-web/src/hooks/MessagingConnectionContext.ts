// 메시징 SSE 연결 상태 컨텍스트.
// useMessageStream 구독 지점이 AppLayout(앱 셸)로 올라가면서, 끊김 배너를 그리는
// 하위 채팅 UI(ChatModuleLayout)가 연결 상태를 읽을 수 있도록 셸에서 아래로 전달한다.
import { createContext, useContext } from 'react'

export interface MessagingConnectionState {
  /** 메시징 SSE 가 활성(연결됨)이면 true, 끊김/재연결 대기 중이면 false */
  isConnected: boolean
}

// 기본값 isConnected=true — Provider 밖(낙관적)에선 끊김 배너를 띄우지 않는다.
export const MessagingConnectionContext = createContext<MessagingConnectionState>({
  isConnected: true,
})

export function useMessagingConnection(): MessagingConnectionState {
  return useContext(MessagingConnectionContext)
}
