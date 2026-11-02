// 노트 HTML 블록 「AI로 고치기」 입력 칸(WP-1302, 설계 WP-1299 §3-3) — 블록 바로 아래에 열려 지시를 받고, AI 가 고친 HTML 을
// 「지금」·「바뀐 뒤」 미리보기로 나란히 보여 준 뒤 「적용」할 때만 블록 소스를 바꾼다. 블록 화면(WikiHtmlEmbedView)이 그린다.
import { Loader2, Sparkles } from 'lucide-react'
import { type KeyboardEvent, memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { PickedElement } from '@/lib/htmlPicker'

import { startWikiAiStream } from '../../hooks/useWikiAiStream'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { useEmbedFrame } from './useEmbedFrame'
import {
  buildFixHtmlRequest,
  cleanAiHtml,
  FIX_HTML_CHIPS,
  FIX_HTML_MAX_PROMPT_CHARS,
  fixHtmlResultProblem,
  lineDiff,
  type LineDiffPart,
  lineDiffStats,
  prefillChip,
} from './wikiHtmlAiFix'
import type { WikiHtmlEmbedAi } from './WikiHtmlEmbedAiContext'
import { keepFocus, pinBlock, pinFlex, pinGrid, pinInlineFlex } from './wikiPinVisible'

// 칸 요소는 블록 막대와 같은 이유로 노트 CSS 가 숨기지 못하게 고정 ref(wikiPinVisible)로 박고, 단추 mousedown 은 keepFocus 로
// 막아 포커스가 입력 칸에 남게 한다(요청 칩을 눌러도 이어 쓸 수 있게).

/** 같은 줄이 이보다 길게 이어지면 앞뒤 몇 줄만 두고 접는다 — 바뀐 곳이 긴 소스에 묻히지 않게. */
const SAME_RUN_FOLD = 8
const SAME_RUN_KEEP = 3

/** 진행 단계 — 입력만(idle)·고치는 중(running)·결과 비교(done)·실패(error). base 는 요청 때 보낸 소스(비교의 「지금」). */
type Run = { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; base: string; result: string } | { phase: 'error'; message: string }

/** 입력 칸에 포커스를 주고 커서를 글 끝에 둔다 — 다시 연 칸·요청 칩으로 채운 글을 바로 이어 쓰게. */
function focusEnd(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

export interface WikiHtmlEmbedAiPanelProps {
  ai: WikiHtmlEmbedAi
  /** 지금 블록 소스(노드 글자) — 보낼 때 읽고, 요청 뒤 바뀌었는지 견준다(「지금」 미리보기는 요청 때 소스로 고정). */
  source: string
  /** 고른 요소(WP-1301 고르기) — 있으면 그 부분만 고치라고 함께 보낸다. */
  picked: readonly PickedElement[]
  /** 고른 요소 칩 줄 — 블록 화면의 칩을 그대로 이 칸 안에 넣는다(칩 화면을 둘 두지 않게). */
  picks: ReactNode
  /** 입력 글자 — 블록 화면이 쥔다(칸을 닫았다 열어도 남게). */
  prompt: string
  onPromptChange: (text: string) => void
  /** 칸 닫기(Esc) — 블록 화면이 칸을 내리고 블록 통째 선택으로 돌아간다. */
  onClose: () => void
  /** 「적용」 — 블록 소스를 바꾼다(한 거래). 블록이 사라졌으면 false. */
  onApply: (html: string) => boolean
}

/**
 * 「AI로 고치기」 입력 칸.
 * - 입력: 자유 지시 + 요청 칩(누르면 시작 말을 채운다 — prefillChip). Enter 보내기 · Shift+Enter 줄바꿈 · Esc 닫기(쓴 글은 남는다).
 *   IME 조합 중 Enter 는 보내지 않는다(한글 마지막 글자 확정 키).
 * - 고치는 중: 받은 글자 수와 「취소」(스트림을 끊는다). 칸을 닫아도(내려가도) 끊는다.
 * - 결과: 「지금」·「바뀐 뒤」 미리보기를 나란히(좁으면 위아래 — 블록 폭 컨테이너 쿼리), 「적용」·「다시 요청」·「취소」, 「바뀐 코드 보기」로 줄 비교.
 *   미리보기는 블록과 같은 격리 iframe(스크립트 허용·same-origin 없음)이고 고르기 스크립트는 넣지 않는다(비교 화면에서 고를 일이 없다).
 * - 「적용」은 편집기의 AI 넣기 길(ai.commit — 판 기록 ✦)로 한 거래에 소스를 바꾼다 — ⌘Z 한 번에 돌아가고 동료에게도 간다.
 */
export function WikiHtmlEmbedAiPanel({
  ai,
  source,
  picked,
  picks,
  prompt,
  onPromptChange,
  onClose,
  onApply,
}: WikiHtmlEmbedAiPanelProps) {
  const [run, setRun] = useState<Run>({ phase: 'idle' })
  // 고치는 중 받은 글자 수 — 토큰마다가 아니라 그림 한 번(requestAnimationFrame)에 한 번만 바꾼다(긴 답에서 토큰마다 다시 그리지 않게).
  const [received, setReceived] = useState(0)
  const [applying, setApplying] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)
  const tickRef = useRef<number | null>(null)
  // 「적용」이 ack 를 기다리는 동안의 중단 — 칸이 내려가면 끊어 닫은 뒤에 블록이 바뀌지 않게 한다.
  const applyAbortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // 입력 칸 콜백 ref — 정체가 바뀌지 않게 한 번 만들어 그릴 때마다 다시 박지 않는다(붙을 때 한 번 고정).
  const setInput = useCallback((el: HTMLTextAreaElement | null) => {
    inputRef.current = el
    pinBlock(el)
  }, [])

  /** 스트림이 끝났을 때(완료·실패) — 끊을 것은 없고 handle 과 남은 글자 수 갱신 예약만 지운다. */
  const endStream = useCallback(() => {
    abortRef.current = null
    if (tickRef.current != null) cancelAnimationFrame(tickRef.current)
    tickRef.current = null
  }, [])
  /** 진행 중인 생성을 끊는다(서버에도 취소) — 새 요청·「취소」·칸 내려감이 함께 쓴다. */
  const stopStream = useCallback(() => {
    abortRef.current?.()
    endStream()
  }, [endStream])

  // 칸이 내려가면(Esc·블록 삭제·노트 이동) 진행 중인 생성과 기다리던 적용을 끊는다 — 받을 곳이 없는 스트림을 서버에 남기지 않게.
  useEffect(
    () => () => {
      stopStream()
      applyAbortRef.current?.abort()
    },
    [stopStream],
  )

  // 열리면 입력 칸에 포커스 — 단추를 누르고 바로 쓰게. 다시 연 칸은 남긴 글 끝에 커서를 둔다.
  useEffect(() => focusEnd(inputRef.current), [])

  const canSend = prompt.trim() !== '' && source.trim() !== '' && run.phase !== 'running' && !applying

  /** 지금 소스·지시·고른 요소로 요청을 보낸다 — 「다시 요청」도 같은 길(고친 지시가 있으면 그것으로). */
  const send = useCallback(() => {
    if (!canSend) return
    stopStream()
    const req = buildFixHtmlRequest(source, prompt, picked)
    // 받은 글은 React 상태가 아니라 이 요청의 버퍼에 모은다 — 화면은 글자 수만 프레임마다 한 번 따라가고, 끝(onDone)에 이 버퍼 전체를 쓴다.
    // 요청마다 새 버퍼라 끊긴 이전 요청의 늦은 조각이 섞이지 않는다.
    let buffer = ''
    setReceived(0)
    setRun({ phase: 'running' })
    const handle = startWikiAiStream({
      pageId: ai.pageId,
      ...req,
      onDelta: (text) => {
        buffer += text
        tickRef.current ??= requestAnimationFrame(() => {
          tickRef.current = null
          setReceived(buffer.length)
        })
      },
      onDone: () => {
        endStream()
        ai.onResult?.()
        const result = cleanAiHtml(buffer)
        const problem = fixHtmlResultProblem(result)
        setRun(problem ? { phase: 'error', message: problem } : { phase: 'done', base: req.selection, result })
      },
      onError: (message) => {
        endStream()
        setRun({ phase: 'error', message })
      },
    })
    abortRef.current = handle.abort
  }, [ai, canSend, picked, prompt, source, stopStream, endStream])

  /** 결과 「취소」 — 버리고 입력으로(블록은 그대로). */
  const discard = () => {
    setRun({ phase: 'idle' })
    inputRef.current?.focus()
  }

  /** 고치는 중 「취소」 — 스트림을 끊고 입력으로 돌아간다(쓴 글 그대로). */
  const cancelRun = () => {
    stopStream()
    discard()
  }

  /** 「적용」 — AI 넣기 길로 소스를 바꾸고, 바꿨으면 지시를 비운다(끝난 요청). 칸 닫기·블록 선택은 onApply 쪽(블록 화면)이 한다. */
  const apply = async () => {
    if (run.phase !== 'done' || applying) return
    setApplying(true)
    const waiting = new AbortController()
    applyAbortRef.current = waiting
    let replaced = false
    try {
      const committed = await ai.commit(() => {
        replaced = onApply(run.result)
      }, waiting.signal)
      replaced = committed && replaced
    } finally {
      if (applyAbortRef.current === waiting) applyAbortRef.current = null
      setApplying(false)
    }
    // 그사이 편집할 수 없게 됐거나(권한 강등·연결 끊김) 블록이 지워졌으면 넣지 않았다 — 결과는 남겨 두고 알린다.
    // 기다리는 사이 칸을 닫았으면(넣지 않음) 사용자가 그만둔 것이라 알리지 않는다. 넣은 뒤 칸이 닫히며 끊긴 것은 넣은 쪽으로 친다.
    if (replaced) onPromptChange('')
    else if (!waiting.signal.aborted) toast.error('블록을 바꾸지 못했습니다 — 편집할 수 있는 상태인지 확인해 주세요.')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    // 조합 중 Enter 는 글자 확정이다 — 보내지 않는다(keyCode 229 는 일부 브라우저의 조합 키).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      send()
    }
  }

  const onChip = (starter: string) => {
    const next = prefillChip(prompt, starter)
    onPromptChange(next)
    // 채운 뒤 커서를 끝에 — 시작 말 뒤를 바로 이어 쓰게(값은 다음 그리기에 들어가므로 한 틱 뒤에 옮긴다).
    requestAnimationFrame(() => focusEnd(inputRef.current))
  }

  return (
    <div ref={pinBlock} className="wiki-html-embed__ai" contentEditable={false} data-testid="wiki-html-embed-ai">
      {picks}
      <textarea
        ref={setInput}
        className="wiki-html-embed__ai-input"
        data-testid="wiki-html-embed-ai-input"
        aria-label="AI에게 고칠 내용"
        placeholder={picked.length ? '고른 부분을 어떻게 고칠까요?' : '이 블록을 어떻게 고칠까요? 예: 3분기 막대를 빨간색으로'}
        rows={2}
        maxLength={FIX_HTML_MAX_PROMPT_CHARS}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div ref={pinFlex} className="wiki-html-embed__ai-row">
        <span ref={pinFlex} className="wiki-html-embed__ai-chips">
          {FIX_HTML_CHIPS.map((chip) => (
            <button
              key={chip.key}
              ref={pinInlineFlex}
              type="button"
              className="wiki-html-embed__ai-chip"
              data-testid={`wiki-html-embed-ai-chip-${chip.key}`}
              onMouseDown={keepFocus}
              onClick={() => onChip(chip.starter)}
            >
              {chip.label}
            </button>
          ))}
        </span>
        <span ref={pinFlex} className="wiki-html-embed__ai-send">
          <span ref={pinInlineFlex} className="wiki-html-embed__ai-hint">
            Enter 보내기 · Esc 닫기
          </span>
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn wiki-html-embed__btn--primary"
            data-testid="wiki-html-embed-ai-send"
            disabled={!canSend}
            onMouseDown={keepFocus}
            onClick={send}
          >
            <Sparkles className="wiki-html-embed__icon" aria-hidden />
            보내기
          </button>
        </span>
      </div>
      {run.phase === 'running' && (
        <div ref={pinFlex} className="wiki-html-embed__ai-status" role="status" data-testid="wiki-html-embed-ai-running">
          <Loader2 className="wiki-html-embed__icon wiki-html-embed__spin" aria-hidden />
          <span ref={pinInlineFlex}>{received ? `AI가 고치는 중… (${received}자 받음)` : 'AI가 고치는 중…'}</span>
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn"
            data-testid="wiki-html-embed-ai-stop"
            onMouseDown={keepFocus}
            onClick={cancelRun}
          >
            취소
          </button>
        </div>
      )}
      {run.phase === 'error' && (
        <div ref={pinFlex} className="wiki-html-embed__ai-status wiki-html-embed__ai-status--error" role="alert" data-testid="wiki-html-embed-ai-error">
          <span ref={pinInlineFlex}>{run.message}</span>
        </div>
      )}
      {run.phase === 'done' && (
        <AiFixResult
          base={run.base}
          stale={source !== run.base}
          result={run.result}
          applying={applying}
          canRetry={canSend}
          onApply={() => void apply()}
          onRetry={send}
          onDiscard={discard}
        />
      )}
    </div>
  )
}

/**
 * 결과 비교 — 미리보기 둘·단추·바뀐 코드. stale 은 요청 뒤 블록 소스가 바뀌었는지(알림).
 * 「바뀐 코드」 펼침은 이 결과의 상태다 — 다시 요청하면 결과 화면이 내려가 접힌 채로 돌아온다.
 */
function AiFixResult({
  base,
  stale,
  result,
  applying,
  canRetry,
  onApply,
  onRetry,
  onDiscard,
}: {
  base: string
  stale: boolean
  result: string
  applying: boolean
  canRetry: boolean
  onApply: () => void
  onRetry: () => void
  onDiscard: () => void
}) {
  const [showCode, setShowCode] = useState(false)
  // 비교·「지금」 미리보기 모두 요청 때 소스(base) 기준이다 — AI 가 고친 원본과 맞대야 바뀐 곳이 정확하고, 결과를 보는 동안
  // 동료·내 편집으로 「지금」 iframe 이 다시 만들어지지 않는다(바뀌었으면 stale 알림으로만 알린다).
  const parts = useMemo(() => lineDiff(base, result), [base, result])
  const stats = useMemo(() => lineDiffStats(parts), [parts])
  return (
    <div ref={pinBlock} className="wiki-html-embed__ai-result" data-testid="wiki-html-embed-ai-result">
      {stale && (
        <p ref={pinBlock} className="wiki-html-embed__ai-note" data-testid="wiki-html-embed-ai-stale">
          요청한 뒤 이 블록 소스가 바뀌었습니다 — 적용하면 그 변경을 덮어씁니다.
        </p>
      )}
      <div ref={pinGrid} className="wiki-html-embed__ai-compare">
        <ComparePreview label="지금" html={base} testId="wiki-html-embed-ai-before" />
        <ComparePreview label="바뀐 뒤" html={result} testId="wiki-html-embed-ai-after" />
      </div>
      <div ref={pinFlex} className="wiki-html-embed__ai-row">
        <button
          ref={pinInlineFlex}
          type="button"
          className="wiki-html-embed__btn wiki-html-embed__ai-code-toggle"
          aria-expanded={showCode}
          data-testid="wiki-html-embed-ai-code-toggle"
          onMouseDown={keepFocus}
          onClick={() => setShowCode((v) => !v)}
        >
          {showCode ? '바뀐 코드 접기 ▴' : '바뀐 코드 보기 ▾'}
          <span className="wiki-html-embed__ai-stats" aria-label={`${stats.added}줄 더함, ${stats.removed}줄 지움`}>
            +{stats.added} −{stats.removed}
          </span>
        </button>
        <span ref={pinFlex} className="wiki-html-embed__ai-send">
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn"
            data-testid="wiki-html-embed-ai-discard"
            onMouseDown={keepFocus}
            onClick={onDiscard}
          >
            취소
          </button>
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn"
            data-testid="wiki-html-embed-ai-retry"
            disabled={!canRetry}
            onMouseDown={keepFocus}
            onClick={onRetry}
          >
            다시 요청
          </button>
          <button
            ref={pinInlineFlex}
            type="button"
            className="wiki-html-embed__btn wiki-html-embed__btn--primary"
            data-testid="wiki-html-embed-ai-apply"
            disabled={applying}
            onMouseDown={keepFocus}
            onClick={onApply}
          >
            {applying ? '적용 중…' : '적용'}
          </button>
        </span>
      </div>
      {showCode && <LineDiffView parts={parts} />}
    </div>
  )
}

/** 비교 미리보기 하나 — 블록과 같은 격리 iframe·높이 보고. 높이는 칸 상한(CSS max-height) 안에서 스크롤. */
function ComparePreview({ label, html, testId }: { label: string; html: string; testId: string }) {
  const { doc, height, frameRef } = useEmbedFrame(html)
  return (
    <figure ref={pinBlock} className="wiki-html-embed__ai-preview" data-testid={testId}>
      <figcaption ref={pinBlock} className="wiki-html-embed__ai-caption">
        {label}
      </figcaption>
      <div ref={pinBlock} className="wiki-html-embed__ai-frame-box">
        <SandboxedHtmlFrame
          ref={frameRef}
          allowScripts
          html={doc}
          title={`HTML 블록 ${label}`}
          className="wiki-html-embed__frame"
          data-testid={`${testId}-frame`}
          style={{ height }}
        />
      </div>
    </figure>
  )
}

/**
 * 줄 비교 그리기 — 지운 줄(−, 빨강)·더한 줄(+, 초록)·같은 줄. 긴 같은 줄은 앞뒤만 두고 「N줄 그대로」로 접는다.
 * memo — parts 는 결과마다 한 번 만들어지므로, 입력 칸 타자·소스 변경으로 결과 화면이 다시 그려져도 긴 비교는 다시 만들지 않는다.
 */
const LineDiffView = memo(function LineDiffView({ parts }: { parts: readonly LineDiffPart[] }) {
  const rows: Array<{ kind: LineDiffPart['kind'] | 'fold'; text: string }> = []
  for (const part of parts) {
    const mark = part.kind === 'added' ? '+' : part.kind === 'removed' ? '−' : ' '
    if (part.kind === 'same' && part.lines.length > SAME_RUN_FOLD) {
      for (const line of part.lines.slice(0, SAME_RUN_KEEP)) rows.push({ kind: 'same', text: `${mark} ${line}` })
      rows.push({ kind: 'fold', text: `⋯ ${part.lines.length - SAME_RUN_KEEP * 2}줄 그대로` })
      for (const line of part.lines.slice(-SAME_RUN_KEEP)) rows.push({ kind: 'same', text: `${mark} ${line}` })
    } else {
      for (const line of part.lines) rows.push({ kind: part.kind, text: `${mark} ${line}` })
    }
  }
  return (
    <pre ref={pinBlock} className="wiki-html-embed__ai-diff" data-testid="wiki-html-embed-ai-diff">
      {rows.map((row, i) => (
        <span key={i} className={`wiki-html-embed__ai-diff-line wiki-html-embed__ai-diff-line--${row.kind}`} data-kind={row.kind}>
          {row.text}
        </span>
      ))}
    </pre>
  )
})
