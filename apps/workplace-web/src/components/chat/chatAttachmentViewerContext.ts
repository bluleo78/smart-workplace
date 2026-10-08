// 채팅 첨부 뷰어 열기 컨텍스트(WP-279) — 호스트(ChatAttachmentViewerHost)와 첨부 목록(MessageAttachmentList)이 공유한다.
// 컴포넌트 파일과 나눈 이유: 컴포넌트 파일이 훅·컨텍스트를 함께 내보내면 Fast Refresh 가 깨진다(react-refresh/only-export-components).
import { createContext, useContext } from 'react'

/** 누른 항목 키로 뷰어를 연다 — 묶음은 호스트가 키의 메시지에서 다시 만든다. */
export type OpenChatAttachment = (key: string) => void

export const ChatAttachmentViewerContext = createContext<OpenChatAttachment | null>(null)

/** 가장 가까운 채팅 뷰어 호스트의 열기 함수 — 호스트 밖(미연결 화면)이면 null 이라 카드가 열리지 않는다. */
export function useOpenChatAttachment(): OpenChatAttachment | null {
  return useContext(ChatAttachmentViewerContext)
}
