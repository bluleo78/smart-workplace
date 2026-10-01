// 모바일 채팅 목록 행(WP-135) — [아이콘 36px] [이름 / 마지막 메시지 한 줄] [시간 / 미읽음 배지].
// 데스크톱 사이드바 행과 별개 마크업 — 데스크톱 DOM 을 바꾸지 않기 위해 모바일에서만 렌더한다.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { formatListTime } from '@/lib/conversationPreview'
import { cn } from '@/lib/utils'

interface Props {
  to: string
  /** 링크 testid — 기존 사이드바와 동일(channel-link-*, dm-link-*, dm-self-link) */
  testId: string
  /** conv-name/preview/time-{key} 접미사 */
  testKey: string
  icon: ReactNode
  name: ReactNode
  /** 이름 옆 보조 표식(에이전트 배지 등) */
  nameAdornment?: ReactNode
  preview: string
  /** ISO 시각. 없으면 시간 칸을 비운다 */
  at?: string | null
  unread: boolean
  /** 오른쪽 아래 배지(숫자 배지·스레드 점) — 기존 testid 를 그대로 가진 요소를 넘긴다 */
  badge?: ReactNode
  active?: boolean
  /** 메시지가 없는 대화 — 미리보기를 흐린 이탤릭으로 */
  empty?: boolean
}

/** 모바일 대화 목록 한 행. 미읽음이면 이름·시간을 굵게 강조한다. */
export function MobileConversationRow({
  to, testId, testKey, icon, name, nameAdornment, preview, at, unread, badge, active, empty,
}: Props) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-md px-3 py-2.5 transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{icon}</span>
      {/* min-w-0 — flex item 기본 min-width:auto 로는 truncate 가 축소되지 않음(#711) */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1">
          <span
            data-testid={`conv-name-${testKey}`}
            className={cn('min-w-0 truncate text-[15px] leading-5', unread ? 'font-semibold' : 'font-normal')}
          >
            {name}
          </span>
          {nameAdornment}
        </span>
        <span
          data-testid={`conv-preview-${testKey}`}
          className={cn(
            'truncate text-[13px] leading-[18px]',
            unread ? 'text-foreground/80' : 'text-muted-foreground',
            empty && 'italic',
          )}
        >
          {preview}
        </span>
      </span>
      {/* 오른쪽 열은 왼쪽 열(이름 20px + 미리보기 18px)과 줄 높이를 맞춰 거울처럼 쌓는다.
          배지 슬롯은 비어 있어도 항상 렌더해 높이를 예약 — 그래야 시간이 배지 유무와 무관하게
          항상 이름 줄 높이에 고정되고 행마다 위아래로 흔들리지 않는다. */}
      <span className="flex shrink-0 flex-col items-end justify-center self-stretch">
        <span
          data-testid={`conv-time-${testKey}`}
          className={cn('text-xs leading-5', unread ? 'font-semibold text-primary' : 'text-muted-foreground')}
        >
          {at ? formatListTime(at) : ''}
        </span>
        <span className="flex h-[18px] items-center">{badge}</span>
      </span>
    </Link>
  )
}
