// 「HTML 문서」 보이는 화면 편집(WP-1309, 설계 WP-1299 §6-3) — 원본 화면을 격리 iframe 에 그대로 띄우고 그 위에서 글자를 눌러 고친다.
// 스크립트가 그린 부분(차트 등)은 ◎ 고르기로 짚어 ✦ AI로 고치기(HTML 블록과 같은 공용 모듈)로 고친다.
import { Crosshair, Sparkles } from 'lucide-react'
import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useHtmlEditFrame } from '@/hooks/useHtmlEditFrame'

import { SandboxedHtmlFrame } from '../../SandboxedHtmlFrame'
import { useHtmlSourceScripts, useNoteAllowsSource } from '../wikiHtmlBlockSecurity'
import type { WikiHtmlEmbedAi } from '../WikiHtmlEmbedAiContext'
import { WikiHtmlEmbedAiPanel } from '../WikiHtmlEmbedAiPanel'
import { VISUAL_EDIT_HINT, VISUAL_EDIT_HINT_NONE } from '../wikiHtmlEmbedHint'
import { HtmlBlockPicks } from '../WikiHtmlEmbedView'

/** 보이는 화면 편집을 부르는 화면이 쓰는 손잡이 — 「저장」·「소스」 전환 전에 iframe 에 남은 입력까지 받아 원본에 되돌린 HTML 을 얻는다. */
export interface WikiHtmlVisualEditorHandle {
  flush: () => Promise<string>
}

/**
 * 보이는 화면 편집.
 * - base: 편집 화면을 띄운 원본 — 이 화면이 떠 있는 동안 바뀌지 않는다. 고친 것은 이 원본에 되돌려(prepared.apply) onChange 로 알린다 — 편집 세션의 소스·임시 저장본이 된다.
 *   기준이 바뀌면(소스에서 돌아옴·AI 적용) 부르는 화면이 key 를 바꿔 새로 띄운다(고친 목록·토큰이 함께 비워진다).
 * - 문서·배선은 HTML 블록과 같은 useHtmlEditFrame — 번호·지문을 단 원본 + 고르기·글자 고치기 스크립트, 스크립트는 허용하되 allow-same-origin 은 없다.
 * - ◎ 고르기를 켜는 동안 글자 고치기를 멈춘다(클릭이 고르기로 간다). ✦ AI로 고치기는 HTML 블록과 같은 입력 칸(WikiHtmlEmbedAiPanel)으로,
 *   지금 소스(current — 고친 글자까지)와 고른 요소를 보내고, 「적용」하면 onReplace 로 원본을 통째로 바꾼다(저장은 「저장」에서).
 * - 노트 스크립트(WP-1290): scriptSource(이 편집에서 스크립트 허용을 따질 소스 — 편집을 열 때·소스에서 돌아올 때·AI 적용 때의 소스)를 노트에 알리고
 *   허용됐으면 문서 스크립트까지 돌리고, 멈춰 있으면 「우리 스크립트만」(SandboxedHtmlFrame pageScripts=false)으로 띄운다 — 글자 고치기·고르기는
 *   어느 쪽이든 돈다. 글자 고치기는 정리기를 거쳐 스크립트를 더하지 못하므로 고친 글자로는 scriptSource 를 바꾸지 않는다(고칠 때마다 멈추지 않게).
 *   띄운 뒤 스위치가 바뀌면 남은 입력까지 받아 onRebase 로 지금 소스를 새 기준으로 다시 띄운다(같은 iframe 의 sandbox 는 바꿀 수 없다).
 */
export function WikiHtmlVisualEditor({
  base,
  scriptSource,
  current,
  pageId,
  title,
  onChange,
  onReplace,
  onRebase,
  handleRef,
}: {
  base: string
  scriptSource: string
  current: string
  pageId: number
  title: string
  onChange: (html: string) => void
  onReplace: (html: string) => void
  /** 노트 스크립트 스위치가 바뀌어 다시 띄워야 할 때 — 지금까지 고친 소스를 넘긴다(부르는 화면이 그것을 base 로 새로 띄운다). */
  onRebase: (html: string) => void
  handleRef?: Ref<WikiHtmlVisualEditorHandle>
}) {
  // 노트 스크립트(WP-1290) — 줄(스위치)이 이 문서를 세게 알리고, 실행 여부는 허용한 묶음과 바로 견준 값을 띄울 때 굳힌다.
  useHtmlSourceScripts(scriptSource)
  const allowed = useNoteAllowsSource(scriptSource)
  const [pageScripts] = useState(allowed)
  const { picker, textEdit, prepared: maybePrepared, script, attach } = useHtmlEditFrame(base, {
    pageScripts,
    onChange: (edits) => onChange(prepared.apply(edits)),
  })
  // base 가 늘 있으니 준비 결과도 늘 있다. 수 MB 문서의 번호 달기는 이 화면을 띄울 때 한 번 — 고치는 동안 iframe 문서는 그대로다.
  const prepared = maybePrepared!
  const { flush } = textEdit
  useImperativeHandle(handleRef, () => ({ flush: async () => prepared.apply(await flush()) }), [flush, prepared])

  // 스위치가 바뀌면 한 번만 다시 띄운다 — 남은 입력을 받은 뒤 지금 소스로.
  const rebasing = useRef(false)
  useEffect(() => {
    if (allowed === pageScripts || rebasing.current) return
    rebasing.current = true
    void flush().then((edits) => onRebase(prepared.apply(edits)))
  }, [allowed, pageScripts, flush, onRebase, prepared])
  const frameRef = useCallback((el: HTMLIFrameElement | null) => (el?.contentWindow ? attach(el.contentWindow) : undefined), [attach])

  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  // HTML 문서는 동기화 서버를 쓰지 않는다 — 「적용」은 편집 중인 소스를 바로 바꾸고(저장은 「저장」) 칸을 닫은 뒤라면 넣지 않는다.
  const ai = useMemo<WikiHtmlEmbedAi>(
    () => ({
      pageId,
      commit: async (insert, signal) => {
        if (signal?.aborted) return false
        insert()
        return true
      },
    }),
    [pageId],
  )
  const picks = picker.enabled || picker.items.length > 0 ? <HtmlBlockPicks picker={picker} /> : null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="wiki-html-visual">
      <div className="wiki-html-embed-scope flex max-h-[60%] shrink-0 flex-col gap-1 overflow-y-auto border-b px-4 py-2" data-testid="wiki-html-visual-bar">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={picker.enabled ? 'secondary' : 'outline'}
            aria-pressed={picker.enabled}
            onClick={() => picker.setEnabled(!picker.enabled)}
            data-testid="wiki-html-visual-pick"
          >
            <Crosshair aria-hidden="true" />
            {picker.enabled ? '고르기 켜짐' : '고르기'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={aiOpen ? 'secondary' : 'outline'}
            aria-pressed={aiOpen}
            onClick={() => setAiOpen((v) => !v)}
            data-testid="wiki-html-visual-ai"
          >
            <Sparkles aria-hidden="true" />
            AI로 고치기
          </Button>
          <span className="min-w-0 text-xs text-muted-foreground" data-testid="wiki-html-visual-hint">
            {prepared.editable > 0 ? VISUAL_EDIT_HINT : VISUAL_EDIT_HINT_NONE}
          </span>
        </div>
        {aiOpen ? (
          <WikiHtmlEmbedAiPanel
            ai={ai}
            subject="문서"
            source={current}
            picked={picker.items}
            picks={picks}
            prompt={aiPrompt}
            onPromptChange={setAiPrompt}
            onClose={() => setAiOpen(false)}
            onApply={(html) => {
              setAiOpen(false)
              onReplace(html)
              return true
            }}
          />
        ) : (
          picks
        )}
      </div>
      <SandboxedHtmlFrame
        ref={frameRef}
        allowScripts
        pageScripts={pageScripts}
        html={prepared.html}
        ownScript={script}
        title={`${title || '제목 없음'} 편집`}
        data-testid="wiki-html-visual-frame"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  )
}
