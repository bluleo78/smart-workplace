// 리포트 저장 위치 고르기 창(WP-1654) — 노트 공간 트리에서 새 리포트를 둘 페이지를 고른다. 이동 창(WikiMovePageDialog)과 같은 모양(검색 + 트리)이다.
// 프로젝트 정기 리포트 설정이 쓰고, 개인 보고(WP-1655)도 문구 prop 만 바꿔 다시 쓰도록 프로젝트 전용 글자는 prop 으로 받는다.

import { FileText, Home, Plus } from 'lucide-react'
import { type KeyboardEvent, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import { isImeComposing } from '@/lib/imeKey'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { useCreatePage, useMovePage } from '../../hooks/queries/useWikiMutations'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import { REPORT_ACTION } from './wikiAiAttribution'
import { pickTargets } from './wikiMoveTargets'

// 들여쓰기 1단계 폭(px) — 사이드바 트리·이동 창과 같은 값.
const INDENT = 16
// 「최상위」 자리의 값 — 페이지 id 와 겹치지 않는 문자열.
const ROOT = 'root'

/** pageId 와 그 조상 id — 부모를 따라 올라간다. 이미 본 id 에서 멈춰 순환 데이터에도 끝난다. */
function ancestorPath(pages: { id: number; parentId: number | null }[], pageId: number | null): Set<number> {
  const out = new Set<number>()
  const parentOf = new Map(pages.map((pg) => [pg.id, pg.parentId]))
  let id = pageId
  while (id != null && !out.has(id)) {
    out.add(id)
    id = parentOf.get(id) ?? null
  }
  return out
}

type Props = {
  open: boolean
  /** 고를 노트 공간 — null 이면 트리를 받지 않는다. */
  spaceId: number | null
  /** 지금 저장 위치 — 그 행에 「지금 위치」를 단다. */
  currentPageId: number | null
  /** 목록에서 뺄 갈래의 루트(「템플릿」 루트·템플릿 페이지 등) — 하위까지 함께 뺀다. */
  blockedRootIds: number[]
  title?: string
  /** 기본 저장 위치 이름 — 위치가 아직 없을 때의 안내 등에 쓴다(WP-1655 에서 「보고」). */
  home?: string
  description?: string
  /** 저장 요청 중 — 「저장」을 잠근다. */
  saving?: boolean
  /** 매뉴얼 도움말 짝 id(data-help) — 공용 컴포넌트라 부르는 화면이 정한다. */
  helpId?: string
  onClose: () => void
  onSave: (pageId: number) => void
}

/** 창 껍데기 — 열릴 때마다 본문을 새로 그려 고른 자리·검색어·입력 줄을 비운다. */
export function ReportLocationDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      {props.open && <ReportLocationBody {...props} />}
    </Dialog>
  )
}

/** 창 본문 — 검색 + 트리(하나 고르기) + 「새 페이지」 입력 줄 + 취소/저장. */
function ReportLocationBody({
  spaceId,
  currentPageId,
  blockedRootIds,
  title = '리포트 저장 위치',
  home = '리포트',
  description = '새 리포트를 고른 페이지 아래에 만들어요. 이미 만든 리포트는 그대로 둬요.',
  saving = false,
  helpId,
  onClose,
  onSave,
}: Props) {
  const tree = useWikiTree(spaceId)
  const createPage = useCreatePage(spaceId ?? 0)
  const movePage = useMovePage(spaceId ?? 0)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  // 이 창에서 만든 페이지 — 「새로 만듦」 표시용. 저장하지 않고 닫아도 페이지는 남는다(되돌리지 않음).
  const [created, setCreated] = useState<Set<number>>(() => new Set())
  // 새 페이지 제목 입력 줄 — null 이면 입력 중이 아니다.
  const [draft, setDraft] = useState<string | null>(null)

  const rows = useMemo(() => {
    const pages = tree.data ?? []
    // 지금 위치와 그 조상 — 서버는 리포트 페이지 자신만 거절하니 지금 위치가 AI 리포트 갈래 안일 수 있다. 빼면 「지금 위치」가 사라진다.
    const keep = ancestorPath(pages, currentPageId)
    // AI 가 쓴 리포트 페이지(aiLastAction='report', 서버 검증과 같은 기준)만 갈래째 뺀다 — 들여쓰기가 어긋나지 않게.
    // 트리의 「AI」 배지(aiLastUsedAt)는 AI 로 다듬기만 해도 붙으니 기준으로 쓰지 않는다.
    const aiIds = pages.filter((pg) => pg.aiLastAction === REPORT_ACTION && !keep.has(pg.id)).map((pg) => pg.id)
    return pickTargets(pages, [...blockedRootIds, ...aiIds])
  }, [tree.data, blockedRootIds, currentPageId])

  const keyword = q.trim().toLowerCase()
  // 검색하면 제목이 맞는 페이지만 남긴다 — 깊이 들여쓰기는 그대로 둬 어느 갈래인지 보이게.
  const shown = keyword ? rows.filter((r) => (r.page.title || '제목 없음').toLowerCase().includes(keyword)) : rows
  // 「최상위」 줄이 보이면 페이지는 그 아래로 한 단계 들여 쓴다 — 검색 중엔 「최상위」가 없어 원래 깊이 그대로.
  const base = keyword ? 0 : 1
  const options = [
    ...(keyword ? [] : [{ value: ROOT, label: '최상위', depth: 0, root: true }]),
    ...shown.map((r) => ({
      value: String(r.page.id),
      label: r.page.title || '제목 없음',
      depth: r.depth + base,
      root: false,
    })),
  ]

  // 입력 줄 자리 — 고른 페이지 바로 아래(한 단계 깊게). 고른 게 없거나 「최상위」면 「최상위」 아래 맨 위 단계.
  const parentValue = selected != null && selected !== ROOT ? selected : null
  const parentIndex = parentValue == null ? -1 : options.findIndex((o) => o.value === parentValue)
  const draftAfter = parentIndex >= 0 ? parentIndex : keyword ? -1 : 0
  const draftDepth = parentIndex >= 0 ? options[parentIndex].depth + 1 : base

  const treeBlocked = tree.isError
  const canSave = selected != null && selected !== ROOT && draft == null && !treeBlocked && !saving

  /** 「＋ 새 페이지」 — 검색어를 비우고 고른 자리 아래에 제목 입력 줄을 연다. */
  const startDraft = () => {
    setQ('')
    setDraft('')
  }

  /**
   * 입력한 제목으로 고른 페이지 아래에 만든다 — 만든 페이지를 「새로 만듦」으로 골라 둔다. 실패하면 입력 줄을 남긴다(토스트는 훅이 띄움).
   * 만들기 API 는 맨 끝에 두므로, 입력 줄이 있던 첫 하위 자리와 서버 순서가 맞게 이동 API 로 첫 자리(position 0)에 옮긴다.
   */
  const submitDraft = async () => {
    const name = (draft ?? '').trim()
    if (!name || createPage.isPending || movePage.isPending) return
    try {
      const parentId = parentValue == null ? null : Number(parentValue)
      const page = await createPage.mutateAsync({ parentId, title: name })
      try {
        await movePage.mutateAsync({ pageId: page.id, parentId, position: 0 })
      } catch {
        // 옮기기만 실패하면 페이지는 맨 끝에 남는다 — 만든 건 그대로 골라 둔다(토스트는 useMovePage 가 띄움).
      }
      setCreated((prev) => new Set(prev).add(page.id))
      setSelected(String(page.id))
      setDraft(null)
    } catch {
      // useCreatePage 의 onError 가 알린다 — 입력은 그대로 둬 고쳐 다시 보낼 수 있게.
    }
  }

  const onDraftKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    // 한글 조합 중 Enter 는 글자 확정이라 만들지 않는다.
    if (isImeComposing(e.nativeEvent)) return
    e.preventDefault()
    void submitDraft()
  }

  /** 「저장」 — 지금 위치를 그대로 고르면 요청 없이 닫는다. */
  const save = () => {
    if (!canSave || selected == null) return
    const id = Number(selected)
    if (id === currentPageId) {
      onClose()
      return
    }
    onSave(id)
  }

  const draftRow = (
    <div
      key="__draft"
      data-testid="report-location-new-row"
      className="flex items-center gap-2 px-2 py-1"
      style={{ paddingLeft: 8 + draftDepth * INDENT }}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Input
        autoFocus
        aria-label="새 페이지 제목"
        placeholder="새 페이지 제목"
        value={draft ?? ''}
        disabled={createPage.isPending || movePage.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onDraftKeyDown}
        className="h-7 text-sm"
      />
    </div>
  )

  return (
    <DialogContent
      data-testid="report-location-dialog"
      data-help={helpId}
      className="sm:max-w-md"
      // Esc 는 입력 중이면 입력 줄만 지운다 — 창까지 닫히면 고르던 자리를 잃는다.
      onEscapeKeyDown={(e) => {
        if (draft != null) {
          e.preventDefault()
          setDraft(null)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <SearchInput value={q} onChange={setQ} placeholder="페이지 검색" className="max-w-none" />
      <div
        role="listbox"
        aria-label="저장 위치"
        className="-mx-1 max-h-80 min-h-24 overflow-y-auto rounded-md border p-1"
        data-testid="report-location-list"
      >
        {draft != null && draftAfter === -1 && draftRow}
        {options.map((o, i) => {
          const isCurrent = !o.root && Number(o.value) === currentPageId
          const isNew = !o.root && created.has(Number(o.value))
          return [
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected === o.value}
              data-testid={`report-location-option-${o.value}`}
              onClick={() => setSelected(o.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                selected === o.value && SELECTED_ROW_CLASS,
              )}
              style={{ paddingLeft: 8 + o.depth * INDENT }}
            >
              {o.root ? (
                <Home className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {isCurrent && <span className="shrink-0 text-xs text-muted-foreground">지금 위치</span>}
              {isNew && <span className="shrink-0 text-xs text-muted-foreground">새로 만듦</span>}
            </button>,
            draft != null && i === draftAfter ? draftRow : null,
          ]
        })}
        {tree.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">페이지 목록을 불러오는 중…</p>
        ) : treeBlocked ? (
          <p role="alert" className="py-6 text-center text-sm text-muted-foreground">
            노트 공간 구성원만 저장 위치를 고를 수 있어요.
          </p>
        ) : (
          options.length === 0 &&
          draft == null && <p className="py-6 text-center text-sm text-muted-foreground">맞는 페이지가 없습니다</p>
        )}
        {/* 아직 아무 페이지도 없을 때 — 다음 리포트 때 기본 위치를 만든다는 안내. */}
        {!tree.isLoading && !treeBlocked && rows.length === 0 && !keyword && (
          <p className="px-2 py-2 text-xs text-muted-foreground">고를 페이지가 없으면 다음 리포트 때 「{home}」을 만들어요.</p>
        )}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={startDraft}
          disabled={treeBlocked || spaceId == null || draft != null}
          data-testid="report-location-new"
        >
          <Plus aria-hidden />새 페이지
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button disabled={!canSave} onClick={save} data-testid="report-location-save">
            저장
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}
