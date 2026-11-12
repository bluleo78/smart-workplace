// 도움말 패널 내용(WP-1505) — 머리(뒤로·도움말·닫기), 검색 칸(WP-1509), 브레드크럼+⌄ 목록, 절 본문, 맨 아래 「✦ AI에게 묻기」.
// 검색 질의가 있는 동안은 본문 자리에 결과 목록을 보이고, 결과를 열면 그 절 위에 「다른 결과」 칩을 단다(useHelpSearchState).
// 데스크톱 오른쪽 aside·AI 와 위아래로 합친 칸·휴대폰 전체 화면 시트가 모두 이 컴포넌트를 그린다(틀·폭은 그리는 쪽 몫).
// 무엇을 보일지는 순수 판정(resolveHelpView: 고른 절 > 주소의 장 첫머리 > 목차)이 정하고, 여기서는 묶음 받기 상태를 화면 상태로 바꾼다:
// 목차 받는 중 → 스켈레톤, 목차 실패 → 불러오지 못함+다시 시도, 장 파일 없음(404)·절 없음 → 목차, 장 파일 그 밖의 실패 → 다시 시도.
// 셸은 이 모듈을 LazyHelpPanel 로 열 때 불러온다(본문 markdown 라이브러리를 첫 화면 번들에서 빼려고).
import { ChevronLeft, CircleHelp, Search, X } from 'lucide-react'
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/Breadcrumb'
import { PanelHeader } from '@/components/layout/PanelHeader'
import { LoadErrorState } from '@/components/LoadErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

import { type HelpIndexChapter, HelpNotFoundError, useHelpChapter, useHelpIndex, useHelpVars } from './helpBundle'
import { HelpMarkdown } from './HelpMarkdown'
import {
  findSection,
  helpBreadcrumb,
  type HelpTarget,
  isChapterVisible,
  relatedSections,
  resolveHelpView,
} from './helpNav'
import { useHelpPanel } from './HelpPanelContext'
import { HelpSearchOtherResults, HelpSearchResults } from './HelpSearchResults'
import { HelpSectionMenu } from './HelpSectionMenu'
import { HelpSkeleton } from './HelpSkeleton'
import { useHelpValues } from './helpValues'
import { HELP_SEARCH_LIST_ID, helpSearchOptionId, useHelpSearchState } from './useHelpSearch'

/** 패널을 닫으면 포커스를 돌려받을 「?」 단추 — 데스크톱 상단 HelpTrigger, 휴대폰 헤더 MobileHelpButton(셸마다 하나만 있다). */
const HELP_TRIGGER_SELECTOR = '[data-help-trigger]'

/**
 * 패널이 닫혀(언마운트) 포커스가 패널 안에 있었으면 「?」 단추로 돌려준다 — ✕·`?` 로 닫으면 누른 요소가 함께 사라져 포커스가 body 로 떨어진다.
 * 패널 밖에 있었으면(페이지에서 `?` 를 누름 등) 그 자리를 건드리지 않는다.
 * 판정은 언마운트 정리 때(아직 DOM 에 붙어 있을 때) 하고, 옮기기는 마이크로태스크로 미룬다 — StrictMode 이중 실행(정리 → 곧바로 다시 마운트)이면
 * 그 사이 다시 마운트되었으므로 옮기지 않는다. 휴대폰 시트는 Radix 대화상자가 닫힐 때 연 자리로 한 번 더 돌려준다(대개 같은 단추).
 */
function useReturnFocusOnClose(rootRef: RefObject<HTMLElement | null>) {
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    const root = rootRef.current
    return () => {
      mounted.current = false
      if (!root?.contains(document.activeElement)) return
      queueMicrotask(() => {
        if (mounted.current) return
        document.querySelector<HTMLElement>(HELP_TRIGGER_SELECTOR)?.focus()
      })
    }
  }, [rootRef])
}

/** 목차 — 이 사용자에게 보이는 장만, 누르면 그 장 첫머리. */
function HelpToc({ index, isAdmin, onPick }: { index: HelpIndexChapter[]; isAdmin: boolean; onPick: (target: HelpTarget) => void }) {
  const chapters = index.filter((ch) => isChapterVisible(ch, isAdmin) && ch.sections.length > 0)
  return (
    <nav data-testid="help-toc" aria-label="목차" className="px-4 py-3">
      <h3 className="pb-2 text-sm font-semibold">목차</h3>
      <ul className="space-y-0.5">
        {chapters.map((ch) => (
          <li key={ch.chapter}>
            <button
              type="button"
              onClick={() => onPick({ chapter: ch.chapter, sectionId: ch.sections[0].id })}
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {ch.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export interface HelpPanelProps {
  className?: string
  /**
   * 「✦ AI에게 묻기」를 눌렀을 때 — 없으면 옆 AI 패널을 연다(데스크톱, 도움말과 나란히 볼 수 있다).
   * 휴대폰 시트는 한 번에 하나만이라 도움말을 닫은 뒤 AI 를 여는 순서(히스토리 항목 정리)를 직접 넘긴다.
   */
  onAskAi?: () => void
}

/** 도움말 패널 내용. 루트에 data-help-panel(패널 안 판별용)·data-testid="help-panel-body". */
export function HelpPanel({ className, onAskAi }: HelpPanelProps) {
  const { nav, select, back, setOpen, setSearchActive, setSearchClear } = useHelpPanel()
  const { isAdmin } = useAuth()
  const aiAvailable = useAiAvailable()
  const { open: openAi } = useAssistant()
  const indexQuery = useHelpIndex()
  const varsQuery = useHelpVars()
  const values = useHelpValues()
  const index = indexQuery.data

  const view = index ? resolveHelpView({ index, pathname: nav.pathname, selected: nav.selected, isAdmin }) : null
  // 지금 절을 문자열 둘로 든다 — 아래 콜백이 렌더마다 새 target 객체에 묶여 바뀌지 않게(HelpMarkdown 본문 재마운트 방지).
  const curChapter = view?.kind === 'section' ? view.target.chapter : null
  const curId = view?.kind === 'section' ? view.target.sectionId : null
  const chapterQuery = useHelpChapter(curChapter)
  const section = chapterQuery.data?.sections.find((s) => s.id === curId) ?? null

  // 다른 절로 간다 — 지금 절이 보이고 있을 때만 뒤로 기록에 쌓는다(목차에서 고른 것은 돌아갈 절이 없다).
  // 절을 옮기면 누른 요소(본문 링크·경로 칸·⌄ 목록 항목·사라지는 「뒤로」)가 함께 사라져 포커스가 body 로 떨어진다 —
  // 옮긴 뒤 내용이 그려지면(스켈레톤이 끝나면) 본문 영역으로 포커스를 옮겨 키보드·스크린 리더가 새 절에서 이어 읽게 한다.
  // 다만 포커스가 검색 칸에 있으면(Enter 로 결과를 연 때) 칸에 둔다 — 질의를 고치거나 Esc 로 지울 수 있게.
  const bodyRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 닫힐 때 포커스 돌려주기(useReturnFocusOnClose) — 패널 루트.
  const rootRef = useRef<HTMLDivElement>(null)
  useReturnFocusOnClose(rootRef)
  const focusBodyAfterMove = useRef(false)
  /**
   * 다른 절로 간다.
   * @param fromToc 목차에서 골랐는가 — 목차에는 돌아갈 절이 없으므로 뒤로 기록에 쌓지 않는다(절 없음으로 목차에 내려온 때도 그 절은 쌓지 않는다).
   */
  const goTo = useCallback(
    (target: HelpTarget, fromToc = false) => {
      focusBodyAfterMove.current = true
      select(target, !fromToc && curChapter !== null && curId !== null ? { chapter: curChapter, sectionId: curId } : null)
    },
    [select, curChapter, curId],
  )
  // 본문 help: 링크가 갈 절 — 묶음에 있고 이 사용자에게 보이는 장의 절만, 나머지(관리자 장 등)는 null(HelpMarkdown 이 글로만 그린다).
  const resolveLink = useCallback(
    (id: string): HelpTarget | null => {
      const ref = index ? findSection(index, id) : null
      return ref && isChapterVisible(ref.chapter, isAdmin) ? { chapter: ref.chapter.chapter, sectionId: ref.section.id } : null
    },
    [index, isAdmin],
  )
  const canNavigate = useCallback((id: string) => resolveLink(id) !== null, [resolveLink])
  const onNavigate = useCallback(
    (id: string) => {
      const target = resolveLink(id)
      if (target) goTo(target)
    },
    [resolveLink, goTo],
  )
  // 「뒤로」 — 마지막 기록이면 단추가 사라지므로 그때만 본문으로 포커스를 옮긴다(남아 있으면 이어 누를 수 있게 그대로 둔다).
  const goBack = () => {
    if (nav.history.length === 1) focusBodyAfterMove.current = true
    back()
  }
  // 검색 — 결과를 열면 그 절로(직접 고름). Enter 로 열면 포커스가 칸에 있어 그대로 남는다(아래 포커스 효과).
  const shown = curChapter !== null && curId !== null ? { chapter: curChapter, sectionId: curId } : null
  const search = useHelpSearchState((hit) => goTo({ chapter: hit.chapter, sectionId: hit.sectionId }), shown)
  // 질의 유무와 지우기 함수를 공급자에 알린다 — 휴대폰 시트가 질의가 있을 때의 Esc 를 닫기 대신 검색 지우기로 받게(MobileHelpSheet).
  // 패널이 사라지면 끄고 지운다.
  const searchActive = search.query !== ''
  useEffect(() => setSearchActive(searchActive), [searchActive, setSearchActive])
  useEffect(() => () => setSearchActive(false), [setSearchActive])
  useEffect(() => {
    setSearchClear(search.clear)
    return () => setSearchClear(null)
  }, [search.clear, setSearchClear])
  const askAi = useCallback(() => (onAskAi ? onAskAi() : openAi('side')), [onAskAi, openAi])

  // 브레드크럼 — 앱 이름(누를 수 없음) › 조상 › 현재. 조상은 누르면 그 절로.
  const crumbs = useMemo<BreadcrumbItem[]>(() => {
    if (!index || curChapter === null || curId === null) return []
    return helpBreadcrumb(index, { chapter: curChapter, sectionId: curId }, nav.pathname).map((c) => ({
      key: c.key,
      label: c.label,
      title: c.label,
      onSelect: c.target ? () => goTo(c.target as HelpTarget) : undefined,
    }))
  }, [index, curChapter, curId, nav.pathname, goTo])

  // 검색 중(결과를 열기 전)에는 본문 자리를 결과 목록이 차지한다 — 보던 절·목차는 nav 에 그대로 있어 Esc 로 지우면 다시 보인다.
  let body: ReactNode
  // 받는 중(스켈레톤) — 본문 영역에 aria-busy 를 단다. curChapter 가 null 이면 목차를 보일 때라 장 파일 질의는 꺼져 있다(pending 이어도 기다리지 않는다).
  let busy = false
  if (search.listing)
    body = <HelpSearchResults results={search.results} isError={search.isError} current={search.current} onOpen={search.open} values={values} vars={varsQuery.data ?? null} />
  else if (indexQuery.isError) body = <LoadErrorState variant="inline" title="도움말을 불러오지 못함" queries={[indexQuery]} testId="help-error" />
  else if (!index || !view || (curChapter !== null && chapterQuery.isPending)) {
    busy = true
    body = <HelpSkeleton />
  }
  else if (curChapter !== null && chapterQuery.isError && !(chapterQuery.error instanceof HelpNotFoundError))
    body = <LoadErrorState variant="inline" title="도움말을 불러오지 못함" queries={[chapterQuery]} testId="help-error" />
  else if (section && curId !== null) {
    // 지금 절의 장 — view 가 목차에서 고른 절이라 늘 있다(타입만 좁힌다).
    const chapterEntry = index.find((ch) => ch.chapter === curChapter)
    body = (
      <>
        {chapterEntry && (
          <div className="px-4 pb-1 pt-1">
            <HelpSectionMenu
              chapter={chapterEntry}
              currentId={curId}
              related={relatedSections(index, section.links, isAdmin, section.id)}
              onSelect={goTo}
            >
              {(trigger) => (
                // 패널이 좁아 경로 글자는 페이지 제목 자리(15px)보다 한 단계 작게 — 접기 규칙은 공용 그대로.
                <Breadcrumb items={crumbs} aria-label="도움말 경로" data-testid="help-breadcrumb" trailing={trigger} className="[&_li>*]:text-sm" />
              )}
            </HelpSectionMenu>
          </div>
        )}
        {/* 본문 위에 제목을 따로 두지 않는다 — 브레드크럼 끝이 지금 절 이름이다. */}
        <div className="px-4 pb-4 pt-2">
          <HelpMarkdown section={section} values={values} vars={varsQuery.data ?? null} onNavigate={onNavigate} canNavigate={canNavigate} />
        </div>
      </>
    )
  }
  // 목차를 보일 때, 그리고 장 파일이 없거나(404) 장 파일에 그 절이 없을 때(목차와 장 파일이 어긋난 배포) 목차로 내려간다.
  else body = <HelpToc index={index} isAdmin={isAdmin} onPick={(target) => goTo(target, true)} />

  // 옮긴 절이 그려진 뒤(받는 중이 아닐 때) 한 번 본문으로 포커스를 옮긴다. 의존성 없이 매 렌더 확인한다(요청이 있을 때만 동작).
  // 포커스가 검색 칸에 있으면 옮기지 않는다 — Enter 로 연 결과는 칸에 남고, 카드·칩을 누른 때는 포커스가 이미 칸을 떠나 본문으로 간다.
  useEffect(() => {
    if (!focusBodyAfterMove.current || busy) return
    focusBodyAfterMove.current = false
    if (document.activeElement === searchInputRef.current) return
    bodyRef.current?.focus({ preventScroll: true })
  })

  return (
    <div ref={rootRef} data-help-panel data-testid="help-panel-body" className={cn('flex h-full min-h-0 w-full flex-col bg-card', className)}>
      <PanelHeader
        data-testid="help-panel-header"
        title={
          <>
            {nav.history.length > 0 && (
              <Button variant="ghost" size="icon-sm" aria-label="뒤로" title="뒤로" data-testid="help-back" onClick={goBack} className="-ml-2 text-muted-foreground">
                <ChevronLeft aria-hidden />
              </Button>
            )}
            <CircleHelp className="size-4 shrink-0 text-primary" aria-hidden />
            <h2 className="truncate text-[15px] font-semibold">도움말</h2>
          </>
        }
        actions={
          <Button variant="ghost" size="icon-sm" aria-label="닫기" title="닫기" data-testid="help-close" onClick={() => setOpen(false)} className="text-muted-foreground">
            <X aria-hidden />
          </Button>
        }
      />
      {/* 검색 칸 — ↑/↓ 로 결과 강조, Enter 로 열기, Esc 로 지우기. 포커스는 칸에 둔 채 강조 카드를 aria-activedescendant 로 알린다. */}
      <div className="shrink-0 px-4 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            role="combobox"
            aria-expanded={search.listing}
            aria-controls={search.listing ? HELP_SEARCH_LIST_ID : undefined}
            aria-activedescendant={search.listing && search.current >= 0 ? helpSearchOptionId(search.current) : undefined}
            aria-autocomplete="list"
            placeholder="도움말 검색"
            aria-label="도움말 검색"
            ref={searchInputRef}
            data-testid="help-search"
            value={search.query}
            onChange={search.onChange}
            onKeyDown={search.onKeyDown}
            className="bg-muted/40 pl-9"
          />
        </div>
      </div>
      {/* tabIndex=-1 — 절을 옮긴 뒤 포커스를 받는 자리(Tab 순서에는 들지 않음). */}
      <div ref={bodyRef} tabIndex={-1} aria-busy={busy} data-testid="help-panel-content" className="min-h-0 flex-1 overflow-y-auto outline-none">
        <HelpSearchOtherResults others={search.others} onOpen={search.open} />
        {body}
      </div>
      {aiAvailable && (
        <div className="shrink-0 border-t p-3">
          <button
            type="button"
            data-testid="help-ask-ai"
            onClick={askAi}
            className="flex h-9 w-full items-center justify-center rounded-md border border-ai-accent/30 bg-ai-accent-subtle text-sm font-medium text-ai-accent transition-colors hover:bg-ai-accent/15"
          >
            ✦ AI에게 묻기
          </button>
        </div>
      )}
    </div>
  )
}
