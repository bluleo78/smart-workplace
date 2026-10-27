// 브레드크럼 보조 — 항목 타입과 접기 규칙(순수 함수). 컴포넌트 파일과 나눠 vitest 로 규칙만 따로 지킨다.
import type { ReactNode } from 'react'

/** 경로 한 단계. 시작점부터 현재까지 순서로 넘기고, 마지막 항목이 현재 위치다. */
export interface BreadcrumbItem {
  /** React key — 단계마다 고유(id 등). */
  key: string | number
  /** 보이는 이름. */
  label: ReactNode
  /** 이동할 주소(react-router `to`). 없으면 링크가 아닌 글자로 그린다 — 현재 항목은 늘 글자다. */
  to?: string
  /**
   * 누르면 할 일 — 주소가 아닌 상태로 옮겨 다니는 화면(채널 서랍 안 드라이브 등)에서 쓴다(WP-979).
   * 있으면 링크 대신 버튼으로 그리고, 접힌 「…」 메뉴에서도 이것을 부른다. to 와 함께 주면 이것이 먼저다.
   */
  onSelect?: () => void
  /** 말줄임됐을 때 마우스를 올리면 보이는 전체 이름. */
  title?: string
  testId?: string
}

/**
 * 접기 규칙 — 항목이 max 보다 많으면 시작점(첫 항목)과 현재(마지막 항목)만 남기고 가운데를 hidden 으로 모은다(§B-1 「접기」).
 * max 이하이면 그대로 둔다(hidden=null). 항목이 2개 이하면 접을 가운데가 없다.
 * keepStart=false 는 시작점까지 접어도 모자랄 만큼 좁을 때(WP-979) — 현재만 남기고 그 앞을 모두 hidden 으로 모은다.
 */
export function collapseBreadcrumbItems(
  items: BreadcrumbItem[],
  max: number,
  { keepStart = true }: { keepStart?: boolean } = {},
): { visible: BreadcrumbItem[]; hidden: BreadcrumbItem[] | null } {
  if (!keepStart && items.length >= 2) return { visible: [items[items.length - 1]], hidden: items.slice(0, -1) }
  if (items.length <= Math.max(max, 2)) return { visible: items, hidden: null }
  return { visible: [items[0], items[items.length - 1]], hidden: items.slice(1, -1) }
}
