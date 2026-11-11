// 프로젝트 탭 본문 틀(WP-1477) — 사이클·버전·타임라인 탭이 같은 모양으로 쓰는 「바깥 세로 flex 래퍼 + 본문 위 오른쪽 정렬 도구 줄」.
// 각 탭이 래퍼·도구 줄 간격을 따로 적으면 탭마다 도구 줄 높이·여백이 달라져 탭을 오갈 때 본문이 들썩인다 — 한 곳에서 정한다.
import type { ReactNode } from 'react'

import { pageGutterClass } from '@/components/layout/Page'
import { cn } from '@/lib/utils'

/**
 * 탭 본문 바깥 래퍼 — Page(세로 flex 전체 높이) 안에서 남은 높이를 채워, 본문(Page.Body)이 스스로 스크롤하게 한다.
 * testid 는 탭 화면마다 그대로 둔다(cycles-page·versions-page·timeline-page).
 */
export function TabScreen({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}

/**
 * 탭 줄 바로 아래 오른쪽 정렬 도구 줄 — 주 액션(새 사이클·버전 만들기·마일스톤 추가)과 탭 고유 도구(타임라인 줌·오늘).
 * 본문(Page.Body) 밖에 두어 본문 로딩·실패 화면의 세로 가운데가 본문 자리 기준 그대로다(WP-938). 좌우 여백은 머리줄과 같은 축.
 * children 이 없으면(권한 없음 등) 줄 자체를 그리지 않아 빈 띠가 남지 않는다.
 */
export function TabToolbar({ testId, children }: { testId?: string; children: ReactNode }) {
  if (!children) return null
  return (
    <div data-testid={testId} className={cn('flex shrink-0 items-center justify-end gap-2 py-2', pageGutterClass)}>
      {children}
    </div>
  )
}
