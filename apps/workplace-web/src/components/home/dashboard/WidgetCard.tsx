// 홈 대시보드 보기 모드 위젯 카드(데스크톱 그리드 한 칸, WP-161 에서 Dashboard.tsx 로부터 분리).
import { Link } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { EntryBody } from './EntryBody'
import { entryDeepLink, entryTitle, isWideEntry, type ResolvedEntry } from './resolvedEntry'

/** 위젯 한 칸(일반 뷰) — 카드 프레임(헤더 클릭 시 딥링크 또는 인박스 패널) + 격리된 본문.
 * 시스템 위젯은 tall 이면 2행 span, 카탈로그 위젯은 size==='1×2' 면 2행 span. */
export function WidgetCard({ entry }: { entry: ResolvedEntry }) {
  const Icon = entry.def.icon
  const title = entryTitle(entry)
  const deepLink = entryDeepLink(entry)
  const tall =
    entry.kind === 'system' ? Boolean(entry.def.tall) : entry.def.size === '1×2'
  // wide: 카운트 스트립·2x2 분면처럼 1/3 폭에 찌그러지는 시스템 위젯 — lg:col-span-3(전체 폭).
  const wide = isWideEntry(entry)
  // 알림처럼 deepLink 가 없는 위젯은 헤더 클릭 시 AppRail 의 인박스 패널을 연다(#274).
  const { openInbox } = useInboxPanel()
  const headerClassName =
    'flex items-center gap-2 text-muted-foreground hover:text-ai-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm'
  const headerInner = (
    <>
      <Icon className="h-4 w-4" />
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
    </>
  )
  const body = <EntryBody entry={entry} />

  // chromeless: 테두리·제목 헤더 없이 본문만 렌더(빠른 액션처럼 자체 설명적인 위젯용). 그리드 폭/행
  // span(wide/tall)은 레이아웃 유지를 위해 그대로 적용한다.
  if (entry.cfg.chromeless) {
    return (
      <div
        className={`${tall ? 'lg:row-span-2' : ''}${wide ? ' lg:col-span-3' : ''}`}
        data-testid="dashboard-widget"
        data-widget={entry.cfg.type}
        data-widget-id={entry.cfg.id}
        data-chromeless="true"
      >
        {body}
      </div>
    )
  }

  return (
    <Card
      className={`border-l-2 border-l-ai-accent${tall ? ' lg:row-span-2' : ''}${wide ? ' lg:col-span-3' : ''}`}
      data-testid="dashboard-widget"
      data-widget={entry.cfg.type}
      data-widget-id={entry.cfg.id}
    >
      <CardHeader className="pb-2">
        {deepLink ? (
          <Link to={deepLink} className={headerClassName}>
            {headerInner}
          </Link>
        ) : entry.cfg.type === 'notifications' ? (
          <button type="button" onClick={() => openInbox()} className={headerClassName}>
            {headerInner}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">{headerInner}</div>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
