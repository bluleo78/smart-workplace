import { useUnreadSummary } from '@/hooks/queries/useMailMessages'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'

/** 안 읽은 수를 세는 대상 — 모바일 탭 id 와 같은 이름을 쓴다(탭바가 그대로 인덱싱). */
export type UnreadKind = 'chat' | 'notifications' | 'mail'

/**
 * 앱별 안 읽은 수 — 모바일 하단 탭바와 데스크톱 앱 레일이 같은 기준의 배지를 그리도록 한곳에서 집계한다(WP-796).
 * chat = 채널+DM 미읽음 합, notifications = 인박스 미읽음, mail = 모든 계정 업무 안 읽은 수(WP-186).
 * 메일 계정이 없으면 서버가 0 을 돌려주므로 배지가 숨는다.
 */
export function useAppUnreadCounts(): Record<UnreadKind, number> {
  const { data: channels = [] } = useMyChannels()
  const { data: dms = [] } = useMyDms()
  const { data: notifications = 0 } = useUnreadCount()
  const { data: mail = 0 } = useUnreadSummary(true)
  const chat = [...channels, ...dms].reduce((s, c) => s + (c.unreadCount ?? 0), 0)
  return { chat, notifications, mail }
}

/**
 * 배지가 붙은 앱 이름 — 접근성 이름·툴팁에 수를 담는다(탭바·레일 공용 문구).
 * 메일은 받은편지함 전체가 아니라 업무 보기 안 읽음 수라 범위를 밝힌다.
 */
export function unreadLabel(label: string, kind: string | undefined, count: number): string {
  if (count <= 0) return label
  return kind === 'mail' ? `${label}, 업무 메일 안 읽음 ${count}` : `${label}, 읽지 않음 ${count}`
}
