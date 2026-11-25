// 「AI 현황 › 처리 이력」 화면(WP-1825) — 조건은 모두 주소에 두고(공유·새로고침 유지), 주소 → 요청 → 목록으로 잇는다.
// 기간이 기본이고, 개요에서 막대·경고로 넘어온 구간(from·to)이 있으면 구간이 기간을 이긴다(구간 칩의 ×로 기간으로 돌아간다).
import { ChevronDown, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { AiRunActorType, AiRunListItem, AiRunStatus } from '@/api/aiStatus'
import { type FacetDef, FacetFilter, type FilterValue } from '@/components/filter'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { useSettingsScrollRoot } from '@/components/layout/settingsScrollRoot'
import { LoadErrorState } from '@/components/LoadErrorState'
import { PeriodToggle } from '@/components/metrics/PeriodToggle'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { SearchInput } from '@/components/ui/search-input'
import { useAiStatusRuns } from '@/hooks/queries/useAiStatusRuns'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSearchDraft } from '@/hooks/useSearchDraft'
import { AI_RUN_KIND_OPTIONS } from '@/lib/aiRunKindLabels'
import { failedWithoutData } from '@/lib/queryFailure'

import { AiStatusHistoryCards } from './AiStatusHistoryCards'
import {
  ACTOR_TYPE_OPTIONS,
  clearNarrowing,
  countLabel,
  hasNarrowing,
  modelOptions,
  parseHistorySearch,
  rangeChipLabel,
  RUN_STATUS_OPTIONS,
  runsBaseKey,
  type RunsFilter,
  toHistorySearch,
  toRunsParams,
  withCurrent,
} from './aiStatusHistoryModel'
import { AiStatusHistoryTable } from './AiStatusHistoryTable'
import { PERIOD_OPTIONS, periodLabel } from './aiStatusModel'
import { AiStatusRunSheet } from './AiStatusRunSheet'
import { AiStatusTabs } from './AiStatusTabs'

/** 지금 시각(ms) — 렌더 순수성 검사를 피해 「기준 시각을 한 번 잡는」 의도를 이름으로 드러낸다. */
const nowMs = () => Date.now()

/** 주소 ↔ 필터. 바꿀 때 이력을 쌓지 않는다(replace) — 필터를 만지작거려도 뒤로 가기가 한 번에 화면을 떠난다. */
function useRunsFilter(): [RunsFilter, (next: RunsFilter) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = useMemo(() => parseHistorySearch(searchParams), [searchParams])
  const setFilter = useCallback((next: RunsFilter) => setSearchParams(toHistorySearch(next), { replace: true }), [setSearchParams])
  return [filter, setFilter]
}

/** 필터 줄의 facet 값 → 필터 조각 */
function facetOne(v: FilterValue[string] | undefined): string | null {
  return v && v.length > 0 ? String(v[v.length - 1]) : null
}

/** 검색 칸 — 입력은 칸이 받고 300ms 쉬면 주소(q)로 올린다(useSearchDraft: 주소가 바깥에서 바뀌면 칸도 따라간다). */
function HistorySearchBox({ value, onWrite }: { value: string; onWrite: (q: string) => void }) {
  const { draft, setDraft } = useSearchDraft(value, onWrite)
  return <SearchInput placeholder="대상·오류 검색" value={draft} onChange={setDraft} className="w-full sm:basis-64" />
}

/** 모바일 기간 칩 — 누르면 기간 목록 팝오버, 고르면 닫는다. 구간이 걸려 있으면 칩은 「기간」이고 어떤 기간도 선택돼 보이지 않는다. */
function MobilePeriodChip({
  period,
  ranged,
  onSelect,
}: {
  period: RunsFilter['period']
  ranged: boolean
  onSelect: (period: RunsFilter['period']) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0" data-testid="ai-run-period-chip">
          {ranged ? '기간' : periodLabel(period)}
          <ChevronDown className="size-3" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="조회 기간 선택" className="w-40 p-1" align="start">
        {PERIOD_OPTIONS.map((o) => (
          <Button
            key={o.value}
            variant={!ranged && o.value === period ? 'secondary' : 'ghost'}
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onSelect(o.value)
              setOpen(false)
            }}
          >
            {o.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** AI 현황 처리 이력 화면. */
export default function AiStatusHistoryPage() {
  const [filter, setFilter] = useRunsFilter()
  // 기간 조회의 기준 시각 — 정규화된 요청 조건이 바뀔 때만 새로 잡는다(주소 글자 그대로가 아니라 — 검색어 끝 공백만 바뀌면 그대로).
  // 렌더마다 바뀌면 쿼리 키가 계속 달라져 끝없이 다시 받는다.
  const baseKey = runsBaseKey(filter)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- baseKey 가 바뀔 때만 다시 잡는 것이 목적
  const baseMs = useMemo(() => nowMs(), [baseKey])
  const params = useMemo(() => toRunsParams(filter, baseMs), [filter, baseMs])
  const query = useAiStatusRuns(params)
  const scrollRoot = useSettingsScrollRoot()
  // 상세 시트 — 선택한 행(null 이면 닫힘). 모바일은 아래에서 올라온다.
  const [selected, setSelected] = useState<AiRunListItem | null>(null)
  const isMobile = useIsMobile()
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  // 종류 선택지 — 주소의 kind 가 알려진 목록에 없어도 칩이 보이게 그 코드를 더한다
  const kindOptions = useMemo(() => withCurrent(AI_RUN_KIND_OPTIONS, filter.kinds), [filter.kinds])
  const facets = useMemo<FacetDef[]>(
    () => [
      { key: 'kind', label: '종류', options: kindOptions },
      { key: 'status', label: '상태', single: true, options: RUN_STATUS_OPTIONS },
      { key: 'actorType', label: '실행 주체', single: true, options: ACTOR_TYPE_OPTIONS },
      { key: 'model', label: '모델', single: true, options: modelOptions(items, filter.model) },
    ],
    [kindOptions, items, filter.model],
  )
  const facetValue: FilterValue = {
    kind: filter.kinds,
    status: filter.status ? [filter.status] : [],
    actorType: filter.actorType ? [filter.actorType] : [],
    model: filter.model ? [filter.model] : [],
  }
  const onFacetChange = (next: FilterValue) => {
    // facet 이 낼 수 있는 값은 선택지 안의 것뿐이다 — 주소 값의 검증은 parseHistorySearch 가 한다
    setFilter({
      ...filter,
      kinds: (next.kind ?? []).map(String),
      status: facetOne(next.status) as AiRunStatus | null,
      actorType: facetOne(next.actorType) as AiRunActorType | null,
      model: facetOne(next.model),
    })
  }

  // 검색 칸 — 데스크톱은 필터 줄 안, 모바일은 칩 줄 위 한 줄. 입력 상태는 칸이 들고 있어 키 입력마다 페이지가 다시 그려지지 않는다.
  const search = <HistorySearchBox value={filter.q} onWrite={(q) => setFilter({ ...filter, q })} />

  // 구간 칩 — 모바일은 필터 앞, 데스크톱은 필터 뒤에 놓는다
  const rangeChip = filter.from && (
    <span
      data-testid="ai-run-range-chip"
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
    >
      {rangeChipLabel(filter.from, filter.to)}
      <button
        type="button"
        aria-label="구간 지우기"
        className="rounded p-0.5 hover:bg-muted"
        onClick={() => setFilter({ ...filter, from: null, to: null })}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  )

  const failed = failedWithoutData(query)
  let body
  if (failed) {
    body = <LoadErrorState title="처리 이력을 불러오지 못함" queries={[query]} testId="ai-run-load-error" />
  } else {
    body = (
      <>
        {isMobile ? (
          <AiStatusHistoryCards items={items} loading={query.isPending} onOpen={setSelected} />
        ) : (
          <AiStatusHistoryTable items={items} loading={query.isPending} onOpen={setSelected} />
        )}
        {!query.isPending && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground" data-testid="ai-run-empty">
            <p>조건에 맞는 처리 없음</p>
            {hasNarrowing(filter) && (
              <Button variant="outline" size="sm" onClick={() => setFilter(clearNarrowing(filter))}>
                필터 초기화
              </Button>
            )}
          </div>
        )}
        <LoadMoreFooter query={query} root={scrollRoot} />
      </>
    )
  }

  return (
    <SettingsPage
      title="AI 현황"
      width="full"
      help={{ id: 'ai-status.history', name: 'AI 현황 처리 이력' }}
      actions={
        // 모바일은 기간을 칩 줄 맨 앞 칩으로 옮긴다(머리 폭이 좁다)
        isMobile ? undefined : (
          <PeriodToggle
            options={PERIOD_OPTIONS}
            // 구간이 걸려 있으면 어떤 기간도 선택된 것으로 보이지 않게 한다 — 어느 기간을 눌러도 기간 조회로 돌아간다
            value={(filter.from ? '' : filter.period) as typeof filter.period}
            onChange={(period) => setFilter({ ...filter, period, from: null, to: null })}
            aria-label="기간"
          />
        )
      }
    >
      <div className="space-y-4" data-help="ai-status.history">
        <AiStatusTabs />
        {isMobile && search}
        <div
          data-testid={isMobile ? 'ai-run-chip-row' : undefined}
          className={isMobile ? 'flex flex-nowrap items-center gap-2 overflow-x-auto' : 'flex flex-wrap items-center gap-3'}
        >
          {!isMobile && search}
          {isMobile && (
            <MobilePeriodChip
              period={filter.period}
              ranged={filter.from !== null}
              onSelect={(period) => setFilter({ ...filter, period, from: null, to: null })}
            />
          )}
          {isMobile && rangeChip}
          <FacetFilter facets={facets} value={facetValue} onChange={onFacetChange} />
          {!isMobile && rangeChip}
          {!failed && !query.isPending && (
            <span className="ml-auto shrink-0 text-sm text-muted-foreground" data-testid="ai-run-count">
              {countLabel(items.length, query.hasNextPage)}
            </span>
          )}
        </div>
        {body}
        <AiStatusRunSheet
          item={selected}
          side={isMobile ? 'bottom' : 'right'}
          onClose={() => setSelected(null)}
          onSameKindFailures={(kind) => {
            // 기간뿐 아니라 개요에서 넘어온 구간(from·to)도 유지한다
            setFilter({ ...clearNarrowing(filter), from: filter.from, to: filter.to, kinds: [kind], status: 'FAILED' })
            setSelected(null)
          }}
        />
      </div>
    </SettingsPage>
  )
}
