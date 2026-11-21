// 홈 대시보드 보기 모드 위젯 카드(데스크톱 그리드 한 칸, WP-161 에서 Dashboard.tsx 로부터 분리).
import { Link } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { HIT_AREA_Y_COARSE } from '@/lib/hitArea'

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
  // 머리말 링크는 글자 높이(20px)만큼만 눌려 터치에서는 위아래로 눌림 영역을 넓힌다(WP-734).
  const headerClassName = `flex items-center gap-2 text-muted-foreground hover:text-ai-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm ${HIT_AREA_Y_COARSE}`
  const headerInner = (
    <>
      {/* shrink-0: 표시 이름이 길어 두 줄이 돼도 아이콘이 flex 축소로 찌그러지지 않게(WP-519). */}
      <Icon className="h-4 w-4 shrink-0" />
      {/* WP-1885: CardTitle(div) 대신 같은 모양의 span — 헤딩 의미는 바깥 h2 가 맡는다. */}
      <span data-slot="card-title" className="leading-none text-sm font-medium">
        {title}
      </span>
    </>
  )
  // 제목을 숨긴(chromeless) 카탈로그 카드는 위젯 자체 제목이 h2 로 카드 제목을 대신한다 — sr-only h2 를 따로 두면
  // 같은 제목이 두 번 읽힌다(WP-1888). 카탈로그 위젯은 오류·빈 상태까지 늘 WidgetFrame 제목을 그린다는 전제다.
  // 시스템 위젯은 자체 제목이 없어 sr-only h2 를 둔다.
  const frameIsCardHeading = entry.cfg.chromeless === true && entry.kind === 'catalog'
  const body = <EntryBody entry={entry} frameHeadingLevel={frameIsCardHeading ? 2 : 3} />

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
        {/* WP-1885: 제목 헤더를 숨겨도 헤딩 탐색에서는 위젯이 잡히도록 보이지 않는 h2 를 둔다. */}
        {!frameIsCardHeading && <h2 className="sr-only">{title}</h2>}
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
        {/* WP-1885: 위젯 제목을 h2 로 — 링크·단추를 헤딩이 감싼다(단추 안에 헤딩 금지). 글꼴은 안쪽 span 이 유지.
            링크 없는 머리는 헤딩 안이라 div 대신 flex span(헤딩 안에는 구문 콘텐츠만 허용).
            h2 는 grid — 자식(알림 단추 등)이 이전처럼 폭 전체로 늘어 눌림 영역이 줄지 않게. */}
        <h2 className="grid">
          {deepLink ? (
            <Link to={deepLink} className={headerClassName}>
              {headerInner}
            </Link>
          ) : entry.cfg.type === 'notifications' ? (
            <button type="button" onClick={() => openInbox()} className={headerClassName}>
              {headerInner}
            </button>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">{headerInner}</span>
          )}
        </h2>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
