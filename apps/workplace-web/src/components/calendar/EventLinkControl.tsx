// 일정 링크 단추(WP-1234) — 일정 대화상자 오른쪽 위 ✕ 바로 왼쪽의 🔗(휴대폰은 ⬆︎). 상세 보기와 편집 폼이 함께 쓴다.
// 이 일정을 지금 보는 대상으로 등록해 ⇧⌘, 도 같은 링크를 복사한다. 반복 일정 회차는 같은 마스터 id 라 시리즈가 열린다.
import { useMemo } from 'react'

import { CopyLinkButton } from '@/components/share/CopyLinkButton'
import { ShareSheetButton } from '@/components/share/ShareSheetButton'
import { useRegisterShareTarget } from '@/components/share/useRegisterShareTarget'
import { useIsMobile } from '@/hooks/useIsMobile'
import { appUrl, calendarEventPath } from '@/lib/appUrl'
import type { ShareTarget } from '@/lib/shareTarget'

export function EventLinkControl({ eventId, title }: { eventId: number; title: string }) {
  const isMobile = useIsMobile()
  const target = useMemo<ShareTarget>(
    () => ({ kind: 'event', url: appUrl(calendarEventPath(eventId)), title }),
    [eventId, title],
  )
  // 일정 창은 화면 위에 뜨는 대화상자(overlay) — 아래 상세 화면보다 늘 이긴다.
  useRegisterShareTarget(target, 'overlay')
  // DialogContent 기준 절대 배치 — ✕(top-4 right-4, 24px) 바로 왼쪽에 세로 가운데를 맞춘다. 머리는 두 단추 폭만큼 오른쪽 여백(pr-16)을 둔다.
  return isMobile ? (
    <ShareSheetButton target={target} className="absolute top-1.5 right-10 z-10" />
  ) : (
    <CopyLinkButton target={target} className="absolute top-2.5 right-11 z-10" />
  )
}
