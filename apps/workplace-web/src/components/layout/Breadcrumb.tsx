// 공용 브레드크럼 — 데스크톱 Page.Header 의 leading(제목 자리)에 「지금 어디인가」를 경로로 보인다(05-page-patterns §B-1 「브레드크럼」).
// 왜: 앱마다 경로를 직접 그리면 구분자·무게·접기가 제각각이 된다. 연락처 조직도(WP-977)에서 만들고 메일·드라이브·노트·이슈(WP-979)로 넓힌다.
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { cn } from '@/lib/utils'

import { type BreadcrumbItem,collapseBreadcrumbItems } from './breadcrumb.helpers'

export type { BreadcrumbItem } from './breadcrumb.helpers'

/** 항목 수 기준 접기 상한 — 이보다 많으면(4단계 초과) 시작·마지막만 남기고 가운데를 「…」로 접는다(§B-1 「접기」). */
const DEFAULT_MAX_ITEMS = 4

// 경로 글자 크기 — 제목 자리라 앱 제목(appTitleTextClass)과 같은 15px. 무게는 항목별로 다르다.
const itemTextClass = 'text-[15px] tracking-tight'
/** 이동 링크(조상 단계) — 옅게, hover 때 진하게. 긴 이름은 말줄임해 마지막(현재) 항목 자리를 지킨다. */
const linkClass = cn(
  itemTextClass,
  'block max-w-48 truncate rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
)
/** 시작점 등 이동할 곳이 없는 항목 — 링크와 같은 색이지만 hover 반응이 없다. */
const plainClass = cn(itemTextClass, 'block max-w-48 truncate text-muted-foreground')
/** 마지막(현재) 항목 — 제목 무게. 폭이 모자라면 이 항목이 마지막으로 말줄임된다. */
const currentClass = cn(itemTextClass, 'block min-w-0 truncate font-semibold text-foreground')

function Separator() {
  return (
    <li aria-hidden className="flex shrink-0 items-center">
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </li>
  )
}

/** 조상 항목 하나 — to 가 있으면 링크(이력에 쌓이는 이동), 없으면 글자만. */
function AncestorItem({ item }: { item: BreadcrumbItem }) {
  return (
    <li className="flex min-w-0 shrink-0 items-center">
      {item.to != null ? (
        <Link to={item.to} title={item.title} data-testid={item.testId} className={linkClass}>
          {item.label}
        </Link>
      ) : (
        <span title={item.title} data-testid={item.testId} className={plainClass}>
          {item.label}
        </span>
      )}
    </li>
  )
}

/** 가운데 접힌 단계 — 「…」 버튼을 누르면 접힌 조상을 위에서 아래 순서로 메뉴에 보인다. */
function CollapsedItems({ items }: { items: BreadcrumbItem[] }) {
  const navigate = useNavigate()
  return (
    <li className="flex shrink-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="breadcrumb-more"
          aria-label={`숨은 경로 ${items.length}단계 보기`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-72">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              data-testid={item.testId}
              disabled={item.to == null}
              onSelect={() => item.to != null && navigate(item.to)}
            >
              <span className="truncate">{item.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** 항목 목록을 한 줄로 그린다 — 접기 판정용 측정 사본과 실제 표시가 같은 마크업을 쓰도록 분리. */
function BreadcrumbRow({ items, hidden }: { items: BreadcrumbItem[]; hidden: BreadcrumbItem[] | null }) {
  const last = items.length - 1
  const out: ReactNode[] = []
  items.forEach((item, i) => {
    if (i > 0) out.push(<Separator key={`sep-${item.key}`} />)
    // 접힌 상태면 시작점 바로 뒤에 「…」을 끼운다.
    if (i === 1 && hidden != null && hidden.length > 0) {
      out.push(<CollapsedItems key="collapsed" items={hidden} />, <Separator key="sep-collapsed" />)
    }
    out.push(
      i === last ? (
        <li key={item.key} className="flex min-w-0 items-center">
          <span aria-current="page" title={item.title} data-testid={item.testId} className={currentClass}>
            {item.label}
          </span>
        </li>
      ) : (
        <AncestorItem key={item.key} item={item} />
      ),
    )
  })
  return <Fragment>{out}</Fragment>
}

/**
 * 공용 브레드크럼. items 는 시작점(앱 안 최상위 단위)부터 현재까지 순서이고, 마지막 항목이 현재 위치다.
 * - 구분자는 ChevronRight 14px muted 하나(`›`·`/` 글자 금지).
 * - 마지막 항목만 제목 무게의 글자, 나머지는 to 가 있으면 링크(Link — 이력에 쌓인다).
 * - maxItems 를 넘거나 폭이 모자라면 시작·마지막만 남기고 가운데를 「…」 메뉴로 접는다. 접어도 모자라면 마지막 항목이 말줄임된다.
 * 폭 판정을 하려면 nav 가 남는 폭을 받아야 한다(flex-1 min-w-0) — Page.Header 에 leadingGrow 를 함께 넘겨 좌측 그룹을 남는 폭만큼 늘린다.
 */
export function Breadcrumb({
  items,
  maxItems = DEFAULT_MAX_ITEMS,
  className,
  'aria-label': ariaLabel = '경로',
  'data-testid': testId = 'breadcrumb',
}: {
  items: BreadcrumbItem[]
  maxItems?: number
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const navRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLOListElement>(null)
  // 폭 부족으로 접었는지 — 항목 수로 접히는 경우와 별개로, 다 펼친 사본의 폭이 nav 폭을 넘으면 켠다.
  const [narrow, setNarrow] = useState(false)
  // 다시 잴 때를 정하는 열쇠 — 보이는 내용(단계 key·글자 이름)이 바뀔 때만. items 배열은 렌더마다 새로 만들어지고
  // to 에는 검색어(q)가 실려, 이들로 잡으면 검색 입력 한 글자마다 다시 잰다.
  const layoutKey = items.map((it) => `${it.key}:${typeof it.label === 'string' ? it.label : ''}`).join('|')

  useLayoutEffect(() => {
    const nav = navRef.current
    const measure = measureRef.current
    if (!nav || !measure || typeof ResizeObserver === 'undefined') return
    // 다 펼친 사본(보이지 않음)의 폭과 nav 가 받은 폭을 비교한다 — 접힌 화면 자체를 재면 다시 펼칠 때를 알 수 없다.
    const check = () => setNarrow(measure.scrollWidth > nav.clientWidth + 0.5)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(nav)
    ro.observe(measure)
    return () => ro.disconnect()
  }, [layoutKey])

  const { visible, hidden } = collapseBreadcrumbItems(items, narrow ? 2 : maxItems)

  return (
    <nav ref={navRef} aria-label={ariaLabel} data-testid={testId} className={cn('relative min-w-0 flex-1', className)}>
      <ol className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <BreadcrumbRow items={visible} hidden={hidden} />
      </ol>
      {/* 접기 판정용 측정 사본 — 다 펼친 경로를 보이지 않게 그려 필요한 폭만 잰다(접근성 트리·탭 순서에서 뺀다). */}
      <ol
        ref={measureRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-1.5 whitespace-nowrap"
      >
        <BreadcrumbRow items={items.map((it) => ({ ...it, testId: undefined }))} hidden={null} />
      </ol>
    </nav>
  )
}
