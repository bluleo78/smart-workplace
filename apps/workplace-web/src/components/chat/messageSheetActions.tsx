// 메시지 작업 시트(MessageActionSheet)의 작업 행 정의 — 팀 채팅·이슈 채팅이 같은 문구·아이콘·순서·권한을 쓰도록 한곳에 둔다.
// 순서 규칙: 스레드 → 복사 → 수정 → 미리보기 지우기 → 삭제(파괴적 작업은 맨 아래).
// 권한은 툴바와 같다: 스레드는 확정 메시지, 수정·삭제는 본인·미삭제·확정 메시지. 복사는 본문이 있는 미삭제 메시지.
import { Copy, Link2Off, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { messagePlainText } from '@/components/mentions/parseMessageSegments'
import { copyText } from '@/lib/copyText'

import type { MessageSheetAction } from './MessageActionSheet'

type Mentions = Parameters<typeof messagePlainText>[1]

/** 시트가 읽는 메시지 필드 — 팀 채팅(MessageResponse)·이슈 채팅(ChatMessageResponse) 공통 부분. */
export interface SheetMessage {
  id: number
  authorId: number
  deleted: boolean
  body: string
  mentions: Mentions
  // 링크 미리보기(WP-874) — 팀 채팅만 가진다. 있을 때만 「미리보기 지우기」 행을 둔다.
  linkPreviews?: readonly unknown[]
}

/** 작업 행이 부를 동작. onThread 가 없으면(이슈 채팅·스레드 패널) 스레드 행을 두지 않는다. */
export interface MessageSheetHandlers<T> {
  currentUserId: number
  onThread?: (m: T) => void
  onEdit: (m: T) => void
  onDelete: (m: T) => void
  // 링크 미리보기 지우기(WP-874) — 팀 채팅만 넘긴다(이슈 채팅엔 미리보기가 없다).
  onDismissPreviews?: (m: T) => void
  // 보관된 채널처럼 읽기 전용이면 수정·삭제를 두지 않는다(WP-508).
  readOnly?: boolean
}

/** 이 메시지에 허용된 작업 — 행 객체를 만들지 않고 판정만(행마다 "작업이 있나"를 볼 때 쓴다). */
function permissions(
  m: SheetMessage,
  {
    currentUserId,
    onThread,
    onDismissPreviews,
    readOnly,
  }: Pick<MessageSheetHandlers<never>, 'currentUserId' | 'onThread' | 'onDismissPreviews' | 'readOnly'>,
) {
  const confirmed = m.id >= 0 // 낙관적 미확정(음수 id)은 서버 작업 불가.
  const edit = !readOnly && m.authorId === currentUserId && !m.deleted && confirmed
  return {
    thread: !!onThread && confirmed,
    copy: !m.deleted && m.body.trim() !== '',
    edit,
    // 미리보기 지우기는 수정과 같은 권한(작성자 본인·확정·미삭제·쓰기 가능) + 미리보기가 있을 때.
    dismissPreviews: edit && !!onDismissPreviews && (m.linkPreviews?.length ?? 0) > 0,
  }
}

/** 시트에 그릴 작업이 하나라도 있는가(반응 줄 제외). */
export function hasMessageSheetActions<T extends SheetMessage>(m: T, h: MessageSheetHandlers<T>): boolean {
  const p = permissions(m, h)
  return p.thread || p.copy || p.edit || p.dismissPreviews
}

/** 시트 대상 메시지의 작업 행 목록. 대상 하나에 대해서만 만든다(행마다 만들지 않는다). */
export function buildMessageSheetActions<T extends SheetMessage>(m: T, h: MessageSheetHandlers<T>): MessageSheetAction[] {
  const p = permissions(m, h)
  const out: MessageSheetAction[] = []
  if (p.thread && h.onThread) {
    const onThread = h.onThread
    out.push({ key: 'thread', label: '스레드에서 답글', icon: <MessageSquare />, onSelect: () => onThread(m) })
  }
  if (p.copy) out.push(copyAction(messagePlainText(m.body, m.mentions)))
  if (p.edit) out.push({ key: 'edit', label: '수정', icon: <Pencil />, onSelect: () => h.onEdit(m) })
  if (p.dismissPreviews && h.onDismissPreviews) {
    const onDismiss = h.onDismissPreviews
    out.push({ key: 'dismiss-previews', label: '미리보기 지우기', icon: <Link2Off />, onSelect: () => onDismiss(m) })
  }
  if (p.edit) out.push({ key: 'delete', label: '삭제', icon: <Trash2 />, onSelect: () => h.onDelete(m), destructive: true })
  return out
}

/** 시트 설명(스크린리더) — "작성자: 본문 앞 40자"(멘션은 @이름). */
export function messagePreview(authorName: string, body: string, mentions: Mentions): string {
  return `${authorName}: ${messagePlainText(body, mentions).slice(0, 40)}`
}

/**
 * 본문 복사 — 툴바엔 없지만 시트에는 둔다. 터치 셸에선 길게 누르기가 텍스트 선택을 대신하므로(선택·콜아웃 억제)
 * 이 행이 없으면 메시지 글을 옮길 방법이 사라진다.
 * 클립보드 API 가 없거나(비보안 컨텍스트) 거부돼도 조용히 끝나지 않게 — 대체 복사까지 실패하면 오류 토스트(C3).
 */
function copyAction(text: string): MessageSheetAction {
  return {
    key: 'copy',
    label: '복사',
    icon: <Copy />,
    onSelect: () => {
      void copyText(text).then((ok) => (ok ? toast.success('메시지를 복사했습니다') : toast.error('메시지를 복사하지 못했습니다')))
    },
  }
}
