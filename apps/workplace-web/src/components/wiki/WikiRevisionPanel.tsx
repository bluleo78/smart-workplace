import { X } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

import { AiLabel } from '@/components/ai/AiLabel'
import { subPaneHeaderClass } from '@/components/layout/Page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { WikiRevisionItem, WikiRevisionList as WikiRevisionListData } from '../../types/wiki'
import type { WikiRevisionHistory } from './useWikiRevisionHistory'
import { groupRevisionsByDay, revisionEditorsLabel, revisionTime } from './wikiRevisionFormat'

/** 목록 한 줄 — 현재 버전 또는 저장된 판. */
type Entry = { kind: 'current'; editedAt: string } | { kind: 'revision'; item: WikiRevisionItem }

/** 목록 응답 → 날짜 묶음("현재 버전" + 저장된 판 최신순). 아직 없으면 빈 목록. */
function groupEntries(data: WikiRevisionListData | undefined) {
  if (!data) return []
  const entries: Entry[] = [
    { kind: 'current', editedAt: data.current.editedAt },
    ...data.items.map((item): Entry => ({ kind: 'revision', item })),
  ]
  return groupRevisionsByDay(entries, (e) => (e.kind === 'current' ? e.editedAt : e.item.editedAt))
}

/**
 * 버전 기록 목록 본문(WP-282) — 데스크톱 패널과 모바일 전체화면(Task 7)이 함께 쓴다.
 * 날짜("오늘"·"어제"·"M월 D일")로 묶고, 맨 위는 "현재 버전"(지금 편집 중인 판), 이어서 저장된 판을 최신순으로 보인다.
 * AI 적용 직전 판은 ✦ "{이름} (AI 수정)" — 그 판을 변경 표시로 보면 AI 가 바꾼 내용이 보인다(R3).
 */
export function WikiRevisionList({ revisions, className }: { revisions: WikiRevisionHistory; className?: string }) {
  const { list, selectedVersion, blockedReason } = revisions
  const { data, isLoading, isError } = list
  // 줄·날짜 묶음은 목록이 새로 올 때만 다시 만든다(판 고르기·변경 표시 토글 렌더마다 묶지 않게).
  const groups = useMemo(() => groupEntries(data), [data])

  if (isError) {
    return <p className={cn('px-4 py-3 text-sm text-muted-foreground', className)}>버전 기록을 불러오지 못했어요</p>
  }
  if (isLoading || !data) {
    return (
      <div className={cn('flex flex-col gap-3 px-4 py-3', className)} data-testid="wiki-revision-list-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    )
  }

  const currentEditors = revisionEditorsLabel(data.current.editors)

  return (
    <div className={cn('flex flex-col pb-2', className)} data-testid="wiki-revision-list">
      {/* 막힌 사유는 툴팁 대신 글자로 — 비활성 버튼엔 hover 가 오지 않고 터치엔 툴팁이 없다. */}
      {blockedReason && (
        <p data-testid="wiki-revision-blocked" className="mx-4 mt-3 rounded-md bg-muted px-3 py-2 text-xs leading-4 text-foreground">
          {blockedReason}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">{g.label}</h3>
          <ul className="flex flex-col">
            {g.entries.map((e) =>
              e.kind === 'current' ? (
                <li key="current">
                  <RevisionRow
                    testId="wiki-revision-item-current"
                    selected={selectedVersion == null}
                    onClick={revisions.clearSelection}
                    primary="현재 버전"
                    secondary={<WhoLine names={currentEditors} suffix="편집 중" />}
                  />
                </li>
              ) : (
                <li key={e.item.version}>
                  <RevisionRow
                    testId={`wiki-revision-item-${e.item.version}`}
                    selected={selectedVersion === e.item.version}
                    onClick={() => revisions.select(e.item.version)}
                    blockedReason={blockedReason}
                    primary={revisionTime(e.item.editedAt)}
                    secondary={<RevisionWho item={e.item} />}
                  />
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
      {data.items.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">아직 저장된 이전 버전이 없어요</p>
      )}
    </div>
  )
}

/**
 * 사람 + 꼬리말 한 줄 — 긴 이름(또는 "외 n명")만 말줄임하고 꼬리말("편집 중"·"복원 전")은 늘 보인다(잘리면 그 판이 무엇인지 모른다).
 * 꼬리말 앞 " · " 는 글자에 둔다 — 화면 간격도 이 공백이 맡는다(바깥 줄은 gap 없음).
 */
function WhoLine({ names, suffix }: { names: string; suffix?: string | null }) {
  if (!names) return <span className="truncate">{suffix}</span>
  return (
    <>
      <span className="min-w-0 truncate">{names}</span>
      {suffix && <span className="shrink-0 whitespace-pre">{` · ${suffix}`}</span>}
    </>
  )
}

/**
 * 판의 편집자 줄 — AI 적용 직전 판은 ✦ "{이름} (AI 수정)", 복원 직전 판은 "복원 전" 을 덧붙인다.
 * AiLabel 은 inline-flex 라 바깥 truncate 가 닿지 않는다 — 안쪽 글자 칸이 직접 말줄임하고 ✦ 아이콘은 줄지 않게 둔다.
 * 이름이 아주 길면 "(AI 수정)" 까지 잘릴 수 있으나 AI 판이라는 신호는 ✦ 아이콘·ai-accent 색이 1차로 맡는다(07 §7.2).
 */
function RevisionWho({ item }: { item: WikiRevisionItem }) {
  if (item.aiActor) {
    return (
      <AiLabel className="min-w-0 max-w-full [&>svg]:shrink-0">
        <span className="min-w-0 truncate">{`${item.aiActor.name} (AI 수정)`}</span>
      </AiLabel>
    )
  }
  return <WhoLine names={revisionEditorsLabel(item.editors)} suffix={item.reason === 'RESTORE' ? '복원 전' : null} />
}

/**
 * 목록 한 줄 버튼 — 선택은 메일 목록과 같은 bg-accent + aria-current 에, 왼쪽 primary 막대(시안의 선택 표시)를 더한다.
 * 다크에선 accent(흰 7%)와 패널 card(흰 3%) 차이가 작아 바탕만으론 선택 줄이 잘 안 보인다. 막대 자리는 모든 줄이 투명 테두리로 비워 둔다(선택 때 글자가 밀리지 않게).
 */
function RevisionRow({
  testId,
  selected,
  onClick,
  primary,
  secondary,
  blockedReason,
}: {
  testId: string
  selected: boolean
  onClick: () => void
  /** 있으면 비활성(사유는 aria-description 으로 읽힌다). */
  blockedReason?: string
  primary: string
  secondary: ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-current={selected ? 'true' : undefined}
      disabled={blockedReason != null}
      aria-description={blockedReason}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 flex-col items-start gap-0.5 border-l-2 py-2 pr-4 pl-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset pointer-coarse:min-h-11',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent enabled:hover:bg-accent/50',
      )}
    >
      <span className="text-sm font-medium leading-5">{primary}</span>
      <span className="flex w-full min-w-0 text-xs leading-4 text-muted-foreground">{secondary}</span>
    </button>
  )
}

/**
 * 데스크톱 버전 기록 패널 — 노트 본문 오른쪽의 인플로우 보조 칸(PersonalTaskPanel 리스트 모드와 같은 방식).
 * 본문을 덮지 않고 옆으로 밀어 공존한다 — 노트는 reading 폭(768px, 왼쪽 정렬)이라 넓은 화면에서도 패널과 겹치지 않는다.
 */
export function WikiRevisionPanel({ revisions }: { revisions: WikiRevisionHistory }) {
  return (
    <aside
      aria-label="버전 기록"
      data-testid="wiki-revision-panel"
      className="flex min-h-0 w-64 shrink-0 flex-col border-l bg-card"
    >
      <div className={subPaneHeaderClass}>
        <span>버전 기록</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="버전 기록 닫기"
          data-testid="wiki-revision-panel-close"
          className="size-7"
          onClick={revisions.close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <WikiRevisionList revisions={revisions} className="min-h-0 flex-1 overflow-y-auto" />
    </aside>
  )
}
