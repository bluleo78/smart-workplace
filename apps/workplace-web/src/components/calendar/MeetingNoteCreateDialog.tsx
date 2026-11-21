// 「회의록 만들기」 창(WP-1702) — 일정에서 회의록 노트를 만든다: 제목 · 위치(공간 › 상위 노트, 「바꾸기」) · 틀 미리보기 · 취소/만들기.
// 제목은 `M/D 일정 제목 회의록` 으로 채워 전체 선택해 둔다. 위치는 지난번 회의록 위치가 살아 있으면 그곳, 아니면 내 공간 최상위
// (lib/meetingNote 의 resolveMeetingNoteLocation). 「바꾸기」는 공용 위치 고르기 창(ReportLocationDialog)을 이 창 위에 겹쳐 연다.
// 위치 기억은 이 창이 하지 않는다 — 노트가 실제로 만들어질 때 useCreateMeetingNote 가 한다. 그래서 고르기만 하고 취소하거나,
// 새 일정에서 「만들기」로 정해 두기만 하고 일정을 저장하지 않으면 다음에도 예전 자리로 시작한다.
import { Home } from 'lucide-react'
import { type RefObject, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormError } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ReportLocationDialog } from '@/components/wiki/ReportLocationDialog'
import { useWikiSpaces } from '@/hooks/queries/useWikiSpaces'
import { useWikiTree } from '@/hooks/queries/useWikiTree'
import { useAuth } from '@/hooks/useAuth'
import { extractApiError } from '@/lib/api-error'
import { isImeComposing } from '@/lib/imeKey'
import {
  loadMeetingNoteLocation,
  type MeetingNoteLocation,
  type MeetingNoteTemplateLine,
  resolveMeetingNoteLocation,
  writableSpaces,
} from '@/lib/meetingNote'
import { WIKI_TITLE_MAX } from '@/lib/wikiLimits'

/**
 * 「만들기」가 넘기는 값 — locationLabel 은 새 일정 카드의 메타 줄(`공간 › 상위`)에 쓴다.
 * titleEdited: 채워 준 제목을 사람이 고쳤는가 — 새 일정은 고치지 않았으면 저장 순간의 날짜·제목으로 다시 만든다.
 */
export interface MeetingNoteCreateInput extends MeetingNoteLocation {
  title: string
  titleEdited: boolean
  locationLabel: string
}

interface MeetingNoteCreateDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** 제목 칸에 채울 값 — 열 때의 일정 제목·날짜로 부르는 쪽이 만든다(열린 동안 일정 제목을 고쳐도 그대로). */
  defaultTitle: string
  /** 틀 미리보기 줄 — 읽기 전용 */
  templateLines: MeetingNoteTemplateLine[]
  /** 만든다 — 거절하면 창 안에 오류를 보이고 열어 둔다. 성공하면 닫는다. */
  onCreate: (input: MeetingNoteCreateInput) => Promise<void>
}

/** 회의록 자리 고르기는 막는 최상위 노트가 없다 — 모듈 상수라 다시 그려도 같은 배열(위치 창의 useMemo 유지). */
const NO_BLOCKED_ROOTS: number[] = []

/** 창 본문 — 열릴 때마다 새로 마운트되어 제목·고른 위치·오류가 처음 상태로 시작한다(NoteLinkDialog 와 같은 방식). */
function MeetingNoteCreateBody({
  defaultTitle,
  templateLines,
  onCreate,
  onClose,
  titleRef,
}: Pick<MeetingNoteCreateDialogProps, 'defaultTitle' | 'templateLines' | 'onCreate'> & {
  onClose: () => void
  titleRef: RefObject<HTMLInputElement | null>
}) {
  const { user, activeTenant } = useAuth()
  const [title, setTitle] = useState(defaultTitle)
  // 「바꾸기」로 고른 자리 — 없으면 해석한 기본 자리(지난번·내 공간)를 쓴다
  const [picked, setPicked] = useState<MeetingNoteLocation | null>(null)
  // 위치 고르기 창에서 보고 있는 공간 — null 이면 닫힘
  const [pickerSpaceId, setPickerSpaceId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // 같은 틱 두 번 누르기 가드 — state 는 다시 그리기 전이라 두 번째 클릭을 못 막는다(노트가 둘 생긴다)
  const creatingRef = useRef(false)

  // 지난번 위치 — 열 때 한 번 읽는다
  const [saved] = useState(() =>
    loadMeetingNoteLocation({ userId: user?.id ?? 0, tenantId: activeTenant?.tenantId ?? null }),
  )
  const spacesQuery = useWikiSpaces()
  const spaces = spacesQuery.data ?? []
  // 위치 고르기 창의 공간 목록 prop — 다시 그릴 때마다 새 배열이면 그 창의 줄 계산(useMemo)이 매번 다시 돈다
  const writable = useMemo(() => writableSpaces(spacesQuery.data ?? []), [spacesQuery.data])
  // 지난번 상위 노트가 아직 그 공간에 있는지 보려면 트리가 필요하다(쓸 수 있는 공간일 때만). 트리를 못 읽으면(403·404) 내 공간으로.
  const needSavedTree = saved?.parentId != null && writable.some((s) => s.id === saved.spaceId)
  const savedTree = useWikiTree(needSavedTree ? saved.spaceId : null)
  const resolving = spacesQuery.isLoading || (needSavedTree && savedTree.isLoading)
  const resolved =
    resolving || !spacesQuery.data
      ? null
      : resolveMeetingNoteLocation(saved, spaces, user?.id, needSavedTree ? (savedTree.data ?? []) : undefined)
  const current: MeetingNoteLocation | null = picked ?? resolved

  // 위치 줄의 상위 노트 제목 — 그 공간 트리에서 찾는다(지난번 위치면 위에서 받은 트리를 캐시로 다시 쓴다).
  // 트리를 받는 중이면 아직 모른다 — 자리표시 제목(「제목 없음」)을 위치 이름·카드에 넣지 않게 만들기를 잠근다.
  const currentTree = useWikiTree(current?.parentId != null ? current.spaceId : null)
  const space = current ? spaces.find((s) => s.id === current.spaceId) : undefined
  const parentPage = current?.parentId != null ? currentTree.data?.find((p) => p.id === current.parentId) : undefined
  const parentLoading = current?.parentId != null && currentTree.isLoading
  // 트리는 받았는데(또는 못 받았는데) 상위 노트가 없다 — 그사이 지워졌거나 볼 수 없다. 「바꾸기」로 다시 고르게 한다.
  const parentMissing = current?.parentId != null && !parentLoading && !parentPage
  // 제목이 빈 노트는 트리처럼 「제목 없음」으로 부른다(실제 노트 이름이라 자리표시가 아니다)
  const locationLabel = space ? (parentPage ? `${space.name} › ${parentPage.title || '제목 없음'}` : space.name) : ''
  // 위치 아래 작은 글씨 — 「바꾸기」로 고른 자리엔 달지 않는다(내 공간이 아닐 수 있다)
  const caption = picked ? null : resolved?.source === 'saved' ? '지난번 회의록 위치' : resolved?.source === 'mine' ? '내 공간' : null

  // 공간 목록을 못 읽었다 — 「공간이 없다」와 구분해 오류와 「다시 시도」를 보인다
  const spacesFailed = spacesQuery.isError && !spacesQuery.data
  const noSpace = !resolving && !spacesFailed && current == null
  const canCreate =
    title.trim() !== '' && current != null && space != null && !parentLoading && !parentMissing && !creating

  async function create() {
    if (!canCreate || creatingRef.current || !current) return
    creatingRef.current = true
    setCreating(true)
    setError(null)
    try {
      const trimmed = title.trim()
      await onCreate({
        title: trimmed,
        titleEdited: trimmed !== defaultTitle.trim(),
        spaceId: current.spaceId,
        parentId: current.parentId,
        locationLabel,
      })
      onClose()
    } catch (e) {
      setError(extractApiError(e, '회의록을 만들지 못했습니다'))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="meeting-note-title">제목</Label>
        <Input
          id="meeting-note-title"
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Enter 로 바로 만든다 — 한글 조합 중 Enter 는 글자 확정이라 넘긴다
            if (e.key === 'Enter' && !isImeComposing(e.nativeEvent)) {
              e.preventDefault()
              void create()
            }
          }}
          autoComplete="off"
          // 노트 제목 한도 — 넘기면 서버가 400 으로 거절한다
          maxLength={WIKI_TITLE_MAX}
          data-testid="meeting-note-title"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">위치</p>
        <div className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5" data-testid="meeting-note-location">
          <Home className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {spacesFailed ? (
            <>
              <span role="alert" className="min-w-0 flex-1 truncate text-sm text-destructive">
                공간 목록을 불러오지 못했습니다
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={spacesQuery.isFetching}
                onClick={() => void spacesQuery.refetch()}
                data-testid="meeting-note-spaces-retry"
              >
                다시 시도
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm">
                {resolving || parentLoading
                  ? '위치를 불러오는 중…'
                  : noSpace
                    ? '노트를 만들 수 있는 공간이 없습니다'
                    : parentMissing
                      ? '상위 노트를 찾을 수 없습니다'
                      : locationLabel}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={resolving || writable.length === 0}
                onClick={() => setPickerSpaceId(current?.spaceId ?? writable[0]?.id ?? null)}
                data-testid="meeting-note-location-change"
              >
                바꾸기
              </Button>
            </>
          )}
        </div>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">틀</p>
        <ul className="space-y-1 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="meeting-note-template">
          {templateLines.map((l) => (
            <li key={l.label} className="break-words">
              {l.value ? `${l.label} · ${l.value}` : l.label}
            </li>
          ))}
        </ul>
      </div>

      <FormError data-testid="meeting-note-error">{error}</FormError>

      {/* 390px 에서 단추가 세로로 쌓이고 「만들기」가 위·가득 폭 — 공용 DialogFooter 의 flex-col-reverse */}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} data-testid="meeting-note-cancel">
          취소
        </Button>
        <Button type="button" disabled={!canCreate} onClick={() => void create()} data-testid="meeting-note-submit">
          만들기
        </Button>
      </DialogFooter>

      {/* 위치 고르기 — 이 창 위에 겹쳐 연다. 쓸 수 있는 공간만 고를 수 있고 「최상위」도 고를 수 있다 */}
      <ReportLocationDialog
        open={pickerSpaceId != null}
        spaceId={pickerSpaceId}
        spaces={writable}
        onSpaceChange={setPickerSpaceId}
        allowRoot
        // 상위 노트가 그사이 지워졌으면(parentMissing) 그 id 를 넘기지 않는다 — 지워진 자리가 골라진 채 열려 그 아래에 만들지 않게(WP-1748)
        currentPageId={current && pickerSpaceId === current.spaceId && !parentMissing ? current.parentId : null}
        blockedRootIds={NO_BLOCKED_ROOTS}
        // 회의록은 리포트와 무관하다 — AI 리포트 페이지 아래에도 둘 수 있게 모두 보인다
        hideAiReports={false}
        title="회의록 위치"
        description="새 회의록을 고른 자리 아래에 만들어요."
        emptyText="고를 노트가 없으면 공간 최상위에 만들어요."
        saveLabel="고르기"
        onClose={() => setPickerSpaceId(null)}
        onSave={(pageId) => {
          if (pickerSpaceId != null) setPicked({ spaceId: pickerSpaceId, parentId: pageId })
          setPickerSpaceId(null)
        }}
      />
    </>
  )
}

export function MeetingNoteCreateDialog({ open, onOpenChange, defaultTitle, templateLines, onCreate }: MeetingNoteCreateDialogProps) {
  const titleRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="meeting-note-dialog"
        // 열자마자 제목 칸에 포커스 + 전체 선택 — 바로 새 제목으로 덮어쓸 수 있게
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          titleRef.current?.focus()
          titleRef.current?.select()
        }}
      >
        <DialogHeader>
          <DialogTitle>회의록 만들기</DialogTitle>
          <DialogDescription className="sr-only">일정의 회의록으로 쓸 새 노트를 만듭니다</DialogDescription>
        </DialogHeader>
        {open && (
          <MeetingNoteCreateBody
            defaultTitle={defaultTitle}
            templateLines={templateLines}
            onCreate={onCreate}
            onClose={() => onOpenChange(false)}
            titleRef={titleRef}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
