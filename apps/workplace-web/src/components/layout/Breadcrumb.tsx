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
/** 접은 뒤에도 현재 항목이 받아야 할 최소 폭(px) — 이것도 안 되면 시작점까지 접는다(몇 글자는 보이게, WP-304·WP-979). */
const CURRENT_MIN_WIDTH = 56

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

/**
 * 항목을 앱이 직접 그리는 훅(WP-979) — 드라이브처럼 경로 항목이 끌어다 놓을 곳이어야 할 때 쓴다.
 * className 은 그 자리의 기본 글자 모양(링크·현재)이라 그대로 붙이면 다른 앱과 같은 모양이 된다. null 을 돌려주면 기본으로 그린다.
 */
export type BreadcrumbRenderItem = (item: BreadcrumbItem, ctx: { current: boolean; className: string }) => ReactNode | null

/** 조상 항목 하나 — onSelect 가 있으면 버튼, to 가 있으면 링크(이력에 쌓이는 이동), 둘 다 없으면 글자만. */
function AncestorItem({ item, renderItem }: { item: BreadcrumbItem; renderItem?: BreadcrumbRenderItem }) {
  const custom = renderItem?.(item, { current: false, className: linkClass })
  return (
    <li className="flex min-w-0 shrink-0 items-center">
      {custom != null ? (
        custom
      ) : item.onSelect != null ? (
        <button type="button" onClick={item.onSelect} title={item.title} data-testid={item.testId} className={cn(linkClass, 'text-left')}>
          {item.label}
        </button>
      ) : item.to != null ? (
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
              disabled={item.to == null && item.onSelect == null}
              onSelect={() => (item.onSelect != null ? item.onSelect() : item.to != null && navigate(item.to))}
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
function BreadcrumbRow({
  items,
  hidden,
  renderItem,
}: {
  items: BreadcrumbItem[]
  hidden: BreadcrumbItem[] | null
  renderItem?: BreadcrumbRenderItem
}) {
  const last = items.length - 1
  const out: ReactNode[] = []
  items.forEach((item, i) => {
    if (i > 0) out.push(<Separator key={`sep-${item.key}`} />)
    // 접힌 상태면 시작점 바로 뒤에 「…」을 끼운다. 시작점까지 접혔으면(현재만 남음) 맨 앞에 끼운다.
    if (i === 0 && items.length === 1 && hidden != null && hidden.length > 0) {
      out.push(<CollapsedItems key="collapsed" items={hidden} />, <Separator key="sep-collapsed" />)
    }
    if (i === 1 && hidden != null && hidden.length > 0) {
      out.push(<CollapsedItems key="collapsed" items={hidden} />, <Separator key="sep-collapsed" />)
    }
    out.push(
      i === last ? (
        <li key={item.key} className="flex min-w-0 items-center">
          {/* 직접 그리는 현재 항목은 aria-current 도 그쪽이 단다(드라이브 DriveCrumbCurrent). */}
          {renderItem?.(item, { current: true, className: currentClass }) ?? (
            <span aria-current="page" title={item.title} data-testid={item.testId} className={currentClass}>
              {item.label}
            </span>
          )}
        </li>
      ) : (
        <AncestorItem key={item.key} item={item} renderItem={renderItem} />
      ),
    )
  })
  return <Fragment>{out}</Fragment>
}

/**
 * 공용 브레드크럼. items 는 시작점(앱 안 최상위 단위)부터 현재까지 순서이고, 마지막 항목이 현재 위치다.
 * - 구분자는 ChevronRight 14px muted 하나(`›`·`/` 글자 금지).
 * - 마지막 항목만 제목 무게의 글자, 나머지는 to 가 있으면 링크(Link — 이력에 쌓인다).
 * - maxItems 를 넘거나 폭이 모자라면 시작·마지막만 남기고 가운데를 「…」 메뉴로 접는다. 그래도 현재 항목이 몇 글자도 못 받을 만큼
 *   좁으면(헤더 왼쪽이 AI 런처 앞까지로 줄어든 1024px 등) 시작점까지 접어 「… › 현재」만 남긴다. 그 뒤로는 마지막 항목이 말줄임된다.
 * 폭 판정을 하려면 nav 가 남는 폭을 받아야 한다(flex-1 min-w-0) — Page.Header 에 leadingGrow 를 함께 넘겨 좌측 그룹을 남는 폭만큼 늘린다.
 */
export function Breadcrumb({
  items,
  maxItems = DEFAULT_MAX_ITEMS,
  className,
  'aria-label': ariaLabel = '경로',
  'data-testid': testId = 'breadcrumb',
  renderItem,
  trailing,
}: {
  items: BreadcrumbItem[]
  /** 항목을 직접 그릴 때(끌어다 놓기 대상 등) — 측정 사본은 늘 기본 모양으로 그린다(폭만 재면 된다). */
  renderItem?: BreadcrumbRenderItem
  /**
   * 경로 바로 뒤에 붙는 표식(노트의 AI 생성 배지 등, WP-979). nav 안에 두어야 접기 판정이 그 폭까지 셈한다 —
   * nav 밖 형제로 두고 nav 를 내용 폭으로 줄이면, 한 번 접힌 뒤 nav 폭이 접힌 줄 폭이 되어 넓혀도 다시 펼치지 않는다.
   */
  trailing?: ReactNode
  maxItems?: number
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const navRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLOListElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  // 폭 부족 단계 — 0: 다 펼침, 1: 시작·현재만(가운데 접기), 2: 현재만(시작점까지 접기).
  // 항목 수로 접히는 경우와 별개로, 다 펼친 사본의 폭이 nav 폭을 넘으면 1, 시작점을 남기면 현재가 최소 폭도 못 받으면 2.
  const [narrow, setNarrow] = useState<0 | 1 | 2>(0)
  // 다시 잴 때를 정하는 열쇠 — 보이는 내용(단계 key·글자 이름)이 바뀔 때만. items 배열은 렌더마다 새로 만들어지고
  // to 에는 검색어(q)가 실려, 이들로 잡으면 검색 입력 한 글자마다 다시 잰다.
  const hasTrailing = trailing != null
  const layoutKey = items.map((it) => `${it.key}:${typeof it.label === 'string' ? it.label : ''}`).join('|')

  useLayoutEffect(() => {
    const nav = navRef.current
    const measure = measureRef.current
    if (!nav || !measure || typeof ResizeObserver === 'undefined') return
    // 다 펼친 사본(보이지 않음)의 폭과 nav 가 받은 폭을 비교한다 — 접힌 화면 자체를 재면 다시 펼칠 때를 알 수 없다.
    // 뒤 표식이 있으면 그 폭과 간격(gap-2 = 8px)까지 더한다.
    const trailingWidth = () => (trailingRef.current ? trailingRef.current.offsetWidth + 8 : 0)
    const check = () => {
      const room = nav.clientWidth + 0.5 - trailingWidth()
      if (measure.scrollWidth <= room) return setNarrow(0)
      // 시작·「…」·현재 줄의 폭 — 시작점 li 폭 + 「…」(28)·구분자 둘(14×2)·간격 넷(6×4) + 현재 최소 폭(56).
      const startWidth = (measure.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
      setNarrow(startWidth + 80 + CURRENT_MIN_WIDTH > room ? 2 : 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(nav)
    ro.observe(measure)
    if (trailingRef.current) ro.observe(trailingRef.current)
    return () => ro.disconnect()
  }, [layoutKey, hasTrailing])

  const { visible, hidden } = collapseBreadcrumbItems(items, narrow > 0 ? 2 : maxItems, { keepStart: narrow < 2 })

  return (
    <nav ref={navRef} aria-label={ariaLabel} data-testid={testId} className={cn('relative flex min-w-0 flex-1 items-center gap-2', className)}>
      <ol className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <BreadcrumbRow items={visible} hidden={hidden} renderItem={renderItem} />
      </ol>
      {hasTrailing && (
        <div ref={trailingRef} className="flex shrink-0 items-center">
          {trailing}
        </div>
      )}
      {/* 접기 판정용 측정 사본 — 다 펼친 경로를 보이지 않게 그려 필요한 폭만 잰다(접근성 트리·탭 순서에서 뺀다). */}
      {/* 사본은 0 폭 상자 안에 가둔다 — 그대로 두면 다 펼친 폭만큼 nav·조상 스크롤 폭이 늘어 가로 넘침이 생긴다. */}
      <div aria-hidden inert className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <ol ref={measureRef} className="flex w-max items-center gap-1.5 whitespace-nowrap">
          <BreadcrumbRow items={items.map((it) => ({ ...it, testId: undefined }))} hidden={null} />
        </ol>
      </div>
    </nav>
  )
}
