// 노드 지시 넓은 편집 창(WP-2092) — 지시 마크다운을 블록 단위로 렌더해 보여 주고, 누른 블록만 원문으로 고친다.
// 바이트 보존: 대화상자가 넘기는 문자열은 고친 블록 말고는 원문과 한 바이트도 다르지 않다(편집 중엔 before + 입력값 + after 로만 조립).
import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAutoGrowTextarea } from '@/hooks/useAutoGrowTextarea'
import { isTextEntryTarget } from '@/lib/escapeOverlay'
import { isImeComposing } from '@/lib/imeKey'
import { isLetterKey } from '@/lib/platform'
import { cn } from '@/lib/utils'

import {
  appendBlock,
  type InstructionDoc,
  instructionHeadings,
  splitInstructionBlocks,
} from './instructionBlocks'
import { applyMarkdownFormat, type MarkdownFormatKind } from './markdownFormat'

/** 이 노드가 함께 받는 공통 지시 — text 가 null 이면 정의가 없는 이름이다. */
export interface SharedInstruction {
  name: string
  text: string | null
}

/** 도구줄 버튼 — aria-label 이 접근성 이름, 눈에 보이는 글자는 label. */
const TOOLS: { kind: MarkdownFormatKind; aria: string; label: string }[] = [
  { kind: 'bold', aria: '굵게', label: 'B' },
  { kind: 'italic', aria: '기울임', label: 'I' },
  { kind: 'h3', aria: '제목 3', label: 'H3' },
  { kind: 'bullet', aria: '글머리 목록', label: '•' },
  { kind: 'ordered', aria: '번호 목록', label: '1.' },
  { kind: 'table', aria: '표', label: '표' },
  { kind: 'code', aria: '코드', label: '</>' },
]

/** 블록이 하나도 없는 문서 — 편집 중이 아닐 때만 파싱하므로 타입을 채우는 자리값. */
const EMPTY_DOC: InstructionDoc = { lead: '', blocks: [] }

/**
 * 입력칸 단축키 Ctrl/Cmd+B·I → 굵게·기울임(서식 모드 도구줄은 입력칸을 떠나지 않게 mousedown 을 막아 키보드로 닿지 않으므로 보완).
 * 한글 자판에선 key 가 ㅠ·ㅑ 로 오므로 물리 키(code)로도 본다. 조합 중이면 건드리지 않는다.
 */
function shortcutFormat(e: React.KeyboardEvent): MarkdownFormatKind | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || isImeComposing(e.nativeEvent)) return null
  if (isLetterKey(e, 'b')) return 'bold'
  if (isLetterKey(e, 'i')) return 'italic'
  return null
}

/**
 * 블록 하나의 렌더 결과 — raw 만 받는 memo 라 한 칸을 고치는 동안 다른 블록은 마크다운을 다시 그리지 않는다
 * (설계: 입력마다 전체를 다시 파싱·렌더하지 않는다).
 */
const BlockView = memo(function BlockView({ raw }: { raw: string }) {
  return <MarkdownMessage>{raw}</MarkdownMessage>
})

/**
 * 지금 편집 중인 한 칸.
 * before/after 는 편집 시작 때 고정한 앞뒤 원문(그대로 유지), value 가 그 사이 입력값.
 * snapshot 은 시작 때의 블록 분해 — 편집 중 입력이 블록 구조를 바꿔도 화면이 다시 그려지며 입력칸이 사라지지 않게 앞뒤를 이것으로 그린다.
 * index 는 snapshot 안 편집 블록 번호(끝에 새로 붙이는 칸·빈 지시 안내 칸은 -1), restore 는 새 칸을 비운 채 끝낼 때 되돌릴 원문.
 */
interface Editing {
  before: string
  after: string
  value: string
  initial: string
  snapshot: InstructionDoc
  index: number
  restore: string | null
}

/** 새 칸을 비운 채인가 — 이때 끝내면 붙였던 빈 줄을 restore 로 되돌린다(타입 좁히기로 restore 가 문자열임을 알린다). */
function isBlankNewBlock(cur: Editing): cur is Editing & { restore: string } {
  return cur.restore !== null && cur.value.trim() === ''
}

/** 편집 중 지시 원문 — 고정한 앞뒤 사이에 입력값을 끼운 것(바이트 보존 조립). */
function joinEditing(cur: Editing): string {
  return cur.before + cur.value + cur.after
}

/** 편집을 끝낸 뒤 포커스를 둘 곳 — 블록 번호, 새로 생긴 마지막 블록('last'), 「+ 블록 추가」·안내 버튼('add'). */
type FocusTarget = number | 'last' | 'add'

export interface InstructionEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeName: string
  nodeKey: string
  text: string
  shared: SharedInstruction[]
  readOnly: boolean
  /** 적용 — 지시가 비면 null, 바꾸지 않았으면 부르지 않는다. */
  onApply: (next: string | null) => void
}

/**
 * 노드 지시 넓은 편집 창. AI 옆 패널과 공존(useAiPanelAwareDialog, WP-54)한다.
 * 편집 상태(draft·모드·편집 칸·공통 지시 보기)는 <Dialog> 밖, 이 컴포넌트가 든다 — AI 패널을 열고 닫으면 modal 값이 바뀌어
 * Radix 가 Content 를 다른 컴포넌트로 다시 마운트하는데, 상태가 Content 안에 있으면 고치던 글이 사라졌다.
 * 상태는 마운트 때 text 에서 시작하므로 호출부는 열려 있는 동안만 마운트한다(열 때마다 새로 시작).
 */
export function InstructionEditorDialog({ open, onOpenChange, nodeName, nodeKey, text, shared, readOnly, onApply }: InstructionEditorDialogProps) {
  const aiAware = useAiPanelAwareDialog({
    open,
    size: 'wide',
    handlers: {
      // 글을 고치는 칸의 Esc 는 편집 취소 몫이라 창을 닫지 않는다(개인 작업 상세 모달과 같은 규칙)
      onEscapeKeyDown: (e) => {
        if (isTextEntryTarget(e.target)) e.preventDefault()
      },
      // 바깥(그래프·서랍) 클릭·포커스로는 닫지 않는다 — 고치던 글이 확인 없이 버려지므로 닫기는 ✕·취소·적용·Esc 로만
      // (AI 패널 쪽 상호작용 허용은 훅이 먼저 처리한다)
      onInteractOutside: (e) => e.preventDefault(),
    },
  })

  const [draft, setDraft] = useState(text)
  // 창을 연 때의 지시 — 적용 때 draft 와 비교한다. 열린 사이 AI·YAML 탭이 text prop 을 바꿔도 안 고친 채 적용하면 옛 글로 덮지 않는다
  const openedText = useRef(text)
  const [mode, setMode] = useState<'format' | 'raw'>('format')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [sharedView, setSharedView] = useState<SharedInstruction | null>(null)
  const editingRef = useRef<Editing | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const centerRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLButtonElement | null>(null)
  // 렌더 뒤에 할 일 — 편집 시작 포커스, 서식 적용 후 선택 복원, 목차 스크롤, Esc 후 포커스
  const pendingEditFocus = useRef(false)
  const pendingSel = useRef<[number, number] | null>(null)
  const pendingScroll = useRef<number | null>(null)
  const pendingFocus = useRef<FocusTarget | null>(null)

  // 편집 중엔 시작 때 스냅숏으로 그리므로 다시 파싱하지 않는다 — 편집이 아닐 때만 draft 를 나눈다
  // 원문 모드에선 목차만 쓰므로 입력마다 바로 나누지 않고 한 박자 늦춘 값으로 나눈다(타이핑을 막지 않게)
  const deferredDraft = useDeferredValue(draft)
  const parseSrc = editing ? null : mode === 'raw' ? deferredDraft : draft
  const parsed = useMemo(() => (parseSrc === null ? null : splitInstructionBlocks(parseSrc)), [parseSrc])
  const shown = editing ? editing.snapshot : (parsed ?? EMPTY_DOC)
  const headings = useMemo(() => instructionHeadings(shown), [shown])
  const canEditBlocks = !readOnly && mode === 'format' && !sharedView

  const setEditingBoth = useCallback((next: Editing | null) => {
    editingRef.current = next
    setEditing(next)
  }, [])

  /** 편집 끝 — 새 칸을 비운 채 끝내면 붙였던 빈 줄까지 원래대로 돌린다. 여러 번 불려도 한 번만 처리(Esc 뒤 blur 등). */
  const endEditing = useCallback(
    (focus?: FocusTarget) => {
      const cur = editingRef.current
      if (!cur) return
      if (isBlankNewBlock(cur)) setDraft(cur.restore)
      if (focus !== undefined) pendingFocus.current = focus
      setEditingBoth(null)
    },
    [setEditingBoth],
  )

  /** 지금 편집을 끝냈을 때의 지시 원문 — 비운 새 칸이면 붙였던 빈 줄을 뺀 원래 글. */
  const settledText = (): string => {
    const cur = editingRef.current
    if (!cur) return draft
    if (isBlankNewBlock(cur)) return cur.restore
    return joinEditing(cur)
  }

  /** src 의 [start, end) 구간을 편집 칸으로 — 앞뒤는 src 에서 잘라 고정하고, 렌더 뒤 입력칸에 포커스를 준다(편집 시작 때만). */
  const beginEdit = (src: string, start: number, end: number, index: number, snapshot: InstructionDoc) => {
    const initial = src.slice(start, end)
    pendingEditFocus.current = true
    setDraft(src)
    setEditingBoth({ before: src.slice(0, start), after: src.slice(end), value: initial, initial, snapshot, index, restore: null })
  }

  /**
   * 블록 index 편집 시작. 이미 다른 칸을 고치던 중이면 그 입력을 draft 에 반영한 글을 다시 나눠, 누른 블록이
   * 새 분해에서 몇 번째인지(시작 위치로) 찾아 연다 — 고친 글이 블록을 쪼개거나 합쳐 번호가 밀려도 엉뚱한 블록이 열리지 않게.
   */
  const startBlockEdit = (index: number) => {
    const cur = editingRef.current
    if (cur) {
      if (index === cur.index) return
      const b = cur.snapshot.blocks[index]
      // 비운 새 칸 — 붙였던 빈 줄을 되돌린 원문에서 그 블록을 바로 연다(스냅숏은 새 칸을 붙이기 전 원문 = restore 기준)
      if (isBlankNewBlock(cur)) {
        if (b) beginEdit(cur.restore, b.start, b.end, index, cur.snapshot)
        else endEditing()
        return
      }
      const next = joinEditing(cur)
      // 새 칸(index -1)은 기존 블록 뒤에 붙어 있어 앞 블록 위치를 밀지 않는다 — 기존 블록을 고치던 중일 때만 뒤 블록이 입력 길이 차만큼 밀린다
      const shift = cur.index >= 0 && index > cur.index ? cur.value.length - cur.initial.length : 0
      const snap = splitInstructionBlocks(next)
      const ni = b ? snap.blocks.findIndex((x) => x.start === b.start + shift) : -1
      if (ni < 0) {
        // 고친 글이 누른 블록까지 삼켰다(닫히지 않은 코드 펜스 등) — 글은 반영하고 편집만 끝낸다
        setDraft(next)
        setEditingBoth(null)
        return
      }
      const nb = snap.blocks[ni]
      beginEdit(next, nb.start, nb.end, ni, snap)
      return
    }
    const doc = parsed ?? splitInstructionBlocks(draft)
    const b = doc.blocks[index]
    if (b) beginEdit(draft, b.start, b.end, index, doc)
  }

  /** 끝에 새 블록 칸을 연다 — 고치던 칸이 있으면 그 글을 반영한 원문 뒤에 붙인다. */
  const startNewEdit = () => {
    const base = settledText()
    const before = appendBlock(base, '')
    pendingEditFocus.current = true
    setEditingBoth({ before, after: '', value: '', initial: '', snapshot: splitInstructionBlocks(base), index: -1, restore: base })
    setDraft(before)
  }

  const startPlaceholderEdit = () => {
    pendingEditFocus.current = true
    setEditingBoth({ before: draft, after: '', value: '', initial: '', snapshot: parsed ?? splitInstructionBlocks(draft), index: -1, restore: null })
  }

  const onEditChange = (value: string) => {
    const cur = editingRef.current
    if (!cur) return
    setEditingBoth({ ...cur, value })
    setDraft(joinEditing({ ...cur, value }))
  }

  // 렌더 뒤 처리 — 편집 시작 포커스·선택 복원·목차 스크롤·Esc 뒤 포커스.
  // 편집 칸 포커스는 편집을 시작할 때만 준다(autoFocus 를 쓰지 않음) — AI 패널 전환으로 Content 가 다시 마운트돼도 AI 입력의 포커스를 뺏지 않게.
  useLayoutEffect(() => {
    if (pendingEditFocus.current && taRef.current) {
      pendingEditFocus.current = false
      taRef.current.focus()
    }
    if (pendingSel.current && taRef.current) {
      const [s, e] = pendingSel.current
      taRef.current.focus()
      taRef.current.setSelectionRange(s, e)
      pendingSel.current = null
    }
    if (pendingScroll.current !== null) {
      const i = pendingScroll.current
      pendingScroll.current = null
      centerRef.current?.querySelector(`[data-block-index="${i}"]`)?.scrollIntoView({ block: 'start' })
    }
    if (pendingFocus.current !== null) {
      const target = pendingFocus.current
      pendingFocus.current = null
      const center = centerRef.current
      if (target === 'add') addRef.current?.focus()
      else if (target === 'last') {
        const blocks = center?.querySelectorAll<HTMLElement>('[data-testid="instruction-block"]')
        const last = blocks && blocks.length > 0 ? blocks[blocks.length - 1] : null
        if (last) last.focus()
        else addRef.current?.focus()
      } else center?.querySelector<HTMLElement>(`[data-block-index="${target}"]`)?.focus()
    }
  })

  // 편집 칸 높이를 내용에 맞춘다 — 안쪽 스크롤 없이 글이 보이게(공용 훅).
  // AI 패널 전환(modal 값 변화)으로 칸이 다시 마운트되면 새 칸의 높이를 다시 맞춰야 하므로 modal 을 값에 섞어 다시 재게 한다.
  useAutoGrowTextarea(taRef, `${aiAware.modal ? 1 : 0}${editing?.value ?? ''}`, mode === 'format')

  /** 도구줄 — 지금 글을 고치는 입력칸(원문 모드는 전체, 서식 모드는 편집 중 블록)에 서식을 넣고 선택을 복원한다. */
  const applyTool = (kind: MarkdownFormatKind) => {
    const ta = taRef.current
    if (!ta) return
    const r = applyMarkdownFormat(ta.value, ta.selectionStart, ta.selectionEnd, kind)
    pendingSel.current = [r.selStart, r.selEnd]
    if (mode === 'raw') setDraft(r.value)
    else onEditChange(r.value)
  }

  /** 입력칸 단축키(Ctrl/Cmd+B·I) — 서식을 넣었으면 브라우저 기본 동작(북마크 등)을 막는다. */
  const onShortcut = (e: React.KeyboardEvent) => {
    const kind = shortcutFormat(e)
    if (!kind) return
    e.preventDefault()
    applyTool(kind)
  }

  const toolsEnabled = !readOnly && !sharedView && (mode === 'raw' || editing !== null)

  const goTo = (index: number) => {
    if (mode === 'format' && !sharedView) {
      centerRef.current?.querySelector(`[data-block-index="${index}"]`)?.scrollIntoView({ block: 'start' })
      return
    }
    pendingScroll.current = index
    setSharedView(null)
    setMode('format')
  }

  const apply = () => {
    if (draft !== openedText.current) onApply(draft.trim() === '' ? null : draft)
    onOpenChange(false)
  }

  /** 편집 칸 한 개(블록 자리·새 칸 공통) */
  const editor = (
    <Textarea
      ref={taRef}
      aria-label="블록 원문"
      value={editing?.value ?? ''}
      className="min-h-0 resize-none overflow-hidden font-mono text-sm"
      onChange={(e) => onEditChange(e.target.value)}
      onBlur={() => endEditing()}
      onKeyDown={(e) => {
        // 한글 조합 중 Esc 는 조합 취소 몫 — 편집을 끝내지 않는다
        if (isImeComposing(e.nativeEvent)) return
        if (e.key === 'Escape') {
          e.preventDefault()
          const cur = editingRef.current
          // 새 칸은 블록 자리가 없다 — 글을 썼으면 새로 생긴 마지막 블록, 비웠으면 「+ 블록 추가」(빈 지시면 안내 버튼)로
          const focus: FocusTarget | undefined = cur && cur.index === -1 ? (cur.value.trim() === '' ? 'add' : 'last') : cur?.index
          endEditing(focus)
          return
        }
        onShortcut(e)
      }}
    />
  )

  const empty = shown.blocks.length === 0 && draft.trim() === '' && !(editing && editing.index === -1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={aiAware.modal}>
      {aiAware.overlay}
      <DialogContent
        showCloseButton={false}
        data-testid="instruction-editor-dialog"
        className={cn(
          'flex h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100%-2rem))]',
          aiAware.contentClassName,
          !aiAware.modal && 'lg:max-w-[min(72rem,calc(100%-var(--right-dock-width)-2rem))]',
        )}
        {...aiAware.contentProps}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base">✦ {nodeName} — 지시 편집</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{`${nodeKey} · ${draft.length}자`}</DialogDescription>
          </div>
          <div className="flex gap-1 rounded-md border p-0.5" role="group" aria-label="편집 방식">
            <Button type="button" size="sm" variant={mode === 'format' ? 'secondary' : 'ghost'} aria-pressed={mode === 'format'} onClick={() => setMode('format')}>
              서식 편집
            </Button>
            <Button type="button" size="sm" variant={mode === 'raw' ? 'secondary' : 'ghost'} aria-pressed={mode === 'raw'} onClick={() => { endEditing(); setSharedView(null); setMode('raw') }}>
              마크다운 원문
            </Button>
          </div>
          <Button type="button" size="sm" variant="ghost" aria-label="창 닫기" onClick={() => onOpenChange(false)}>
            ✕
          </Button>
        </div>

        <div className="flex items-center gap-1 border-b px-5 py-1.5" role="toolbar" aria-label="서식 도구">
          {TOOLS.map((t) => (
            <Button
              key={t.kind}
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t.aria}
              disabled={!toolsEnabled}
              // 눌러도 입력칸이 포커스를 잃어(blur) 편집이 끝나지 않게
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyTool(t.kind)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="w-56 shrink-0 overflow-y-auto border-r p-3 text-sm">
            <nav aria-label="목차">
              <div className="mb-1 text-xs font-medium text-muted-foreground">목차</div>
              {headings.length === 0 ? (
                <p className="text-xs text-muted-foreground">제목(##)이 없어요</p>
              ) : (
                <ul>
                  {headings.map((h) => (
                    <li key={h.index}>
                      <button
                        type="button"
                        className={cn('w-full truncate rounded px-2 py-1 text-left hover:bg-muted', h.depth === 3 && 'pl-5 text-muted-foreground')}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => goTo(h.index)}
                      >
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-muted-foreground">함께 받는 공통 지시</div>
              {shared.length > 0 && <p className="mb-1 text-xs text-muted-foreground">누르면 그 글을 읽기만 — 고치기는 「공통 지시」에서</p>}
              <ul>
                {shared.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      disabled={s.text === null}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-muted disabled:opacity-60"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { endEditing(); setSharedView(s) }}
                    >
                      <span className="truncate">{s.name}</span>
                      {s.text === null && <span className="text-xs text-muted-foreground">정의 없음</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <div ref={centerRef} className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-3xl">
              {sharedView ? (
                <div>
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
                    <span>{`공통 지시 ${sharedView.name} — 읽기 전용`}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => setSharedView(null)}>
                      지시로 돌아가기
                    </Button>
                  </div>
                  <MarkdownMessage>{sharedView.text ?? ''}</MarkdownMessage>
                </div>
              ) : mode === 'raw' ? (
                <Textarea
                  ref={taRef}
                  aria-label="지시 원문"
                  readOnly={readOnly}
                  value={draft}
                  className="min-h-[60vh] font-mono text-sm"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (!readOnly) onShortcut(e)
                  }}
                />
              ) : (
                <>
                  {shown.blocks.map((b, i) =>
                    editing && editing.index === i ? (
                      <div key={i} data-block-index={i} className="my-2">
                        {editor}
                      </div>
                    ) : (
                      <div
                        key={i}
                        data-testid="instruction-block"
                        data-block-index={i}
                        {...(canEditBlocks
                          ? {
                              role: 'button',
                              tabIndex: 0,
                              'aria-label': '블록 편집',
                              onMouseDown: (e: React.MouseEvent) => {
                                // 편집 중 다른 블록을 눌러도 입력칸 blur 로 화면이 먼저 바뀌지 않게 — 옮기기는 click 에서
                                if (editingRef.current) e.preventDefault()
                              },
                              onClick: (e: React.MouseEvent) => {
                                if ((e.target as HTMLElement).closest('a')) return
                                startBlockEdit(i)
                              },
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.target !== e.currentTarget) return
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  startBlockEdit(i)
                                }
                              },
                            }
                          : {})}
                        className={cn('my-1 rounded-md px-2 py-1', canEditBlocks && 'cursor-text hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none')}
                      >
                        <BlockView raw={b.raw} />
                      </div>
                    ),
                  )}
                  {editing && editing.index === -1 ? (
                    <div className="my-2">{editor}</div>
                  ) : empty ? (
                    readOnly ? null : (
                      <button
                        ref={addRef}
                        type="button"
                        className="w-full rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground hover:bg-muted/60"
                        onClick={startPlaceholderEdit}
                      >
                        여기를 눌러 지시를 쓰세요
                      </button>
                    )
                  ) : (
                    canEditBlocks && (
                      <Button ref={addRef} type="button" size="sm" variant="ghost" className="mt-2" onMouseDown={(e) => { if (editingRef.current) e.preventDefault() }} onClick={startNewEdit}>
                        + 블록 추가
                      </Button>
                    )
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">적용하면 초안에 반영돼요 — 게시해야 AI 에게 갑니다</p>
          <div className="flex gap-2">
            {readOnly ? (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  취소
                </Button>
                <Button type="button" onClick={apply}>
                  적용
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
