// 메시지 작업 시트(MessageActionSheet)의 작업 행 정의 — 팀 채팅·이슈 채팅이 같은 문구·아이콘·순서를 쓰도록 한곳에 둔다.
// 순서 규칙: 스레드 → 복사 → 수정 → 삭제(파괴적 작업은 맨 아래).
import { Copy, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { copyText } from '@/lib/copyText'

import type { MessageSheetAction } from './MessageActionSheet'

export const threadAction = (onSelect: () => void): MessageSheetAction => ({
  key: 'thread',
  label: '스레드에서 답글',
  icon: <MessageSquare />,
  onSelect,
})

/**
 * 본문 복사 — 툴바엔 없지만 시트에는 둔다. 터치 셸에선 길게 누르기가 텍스트 선택을 대신하므로(선택·콜아웃 억제)
 * 이 행이 없으면 메시지 글을 옮길 방법이 사라진다.
 */
export const copyAction = (text: string): MessageSheetAction => ({
  key: 'copy',
  label: '복사',
  icon: <Copy />,
  // 클립보드 API 가 없거나(비보안 컨텍스트) 거부돼도 조용히 끝나지 않게 — 대체 복사까지 실패하면 오류 토스트(C3).
  onSelect: () => {
    void copyText(text).then((ok) => (ok ? toast.success('메시지를 복사했습니다') : toast.error('복사하지 못했어요')))
  },
})

export const editAction = (onSelect: () => void): MessageSheetAction => ({
  key: 'edit',
  label: '수정',
  icon: <Pencil />,
  onSelect,
})

export const deleteAction = (onSelect: () => void): MessageSheetAction => ({
  key: 'delete',
  label: '삭제',
  icon: <Trash2 />,
  onSelect,
  destructive: true,
})
