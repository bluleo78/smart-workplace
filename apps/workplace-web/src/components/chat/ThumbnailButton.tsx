import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 채팅 이미지 썸네일 감싸개(WP-279) — 팀·이슈·메인 AI 채팅 썸네일이 함께 쓴다.
 * onOpen 이 있으면 버튼(누르면 통합 뷰어)으로, 없으면(미확정 메시지·세션 전 AI 턴) 누를 수 없는 블록으로 그린다.
 * 왜 버튼인가: 예전 <a target="_blank"> 는 새 탭으로 나갔다 — 이제 앱 안 뷰어로 열고, 뷰어를 닫으면 이 버튼으로 포커스가 돌아온다.
 * 접근 이름은 "{파일명} 미리보기"(메일 첨부 칩·파일 카드와 같은 규칙).
 */
export function ThumbnailButton({
  name,
  fileId,
  onOpen,
  className,
  children,
}: {
  name: string
  fileId: number
  onOpen?: () => void
  className?: string
  children: ReactNode
}) {
  if (!onOpen) return <span className={cn('inline-block', className)}>{children}</span>
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name} 미리보기`}
      data-testid={`attachment-image-open-${fileId}`}
      // 버튼 기본 여백·배경을 없애 예전 링크 썸네일과 같은 모양을 유지하고, 키보드 포커스만 링으로 보인다.
      // 터치(coarse)에선 그림이 작아도 누르는 영역이 44px 이상이 되게 최소 크기를 둔다(작은 그림은 가운데).
      className={cn(
        'inline-flex cursor-zoom-in items-center justify-center rounded-md p-0 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        className,
      )}
    >
      {children}
    </button>
  )
}
