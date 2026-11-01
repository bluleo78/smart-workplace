import { Code } from 'lucide-react'
import { useMemo, useState } from 'react'

import { htmlHasScripts } from '../../lib/sandboxedHtml'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { Button } from '../ui/button'

/**
 * HTML 파일 미리보기(드라이브·첨부 공용, WP-1260).
 *
 * - 기본은 스크립트 차단 격리 iframe 이다(#486·#732) — 받은 HTML 은 신뢰할 수 없다.
 * - 스크립트가 든 문서(발표 자료처럼 스크립트가 배치·이동을 맡는 문서)는 차단하면 모양이 무너지므로,
 *   위에 안내 줄과 「스크립트 실행」 단추를 둔다. 누르면 이 미리보기만 노트 HTML 블록(WP-1242)과 같은 격리
 *   (allowScripts — 불투명 출처라 앱 쿠키·저장소·화면에 닿지 못함, 대화상자 차단)로 다시 그린다.
 * - 허용은 그 문서에만 걸린다 — 허용한 문서 문자열을 기억해 두고 같을 때만 허용하므로, 같은 자리에서 내용이 바뀌어도(다시 받기)
 *   새 문서는 다시 차단된다. 뷰어가 항목마다 key 로 새로 붙여 다른 파일로 넘기거나 다시 열어도 차단으로 돌아간다.
 */
export function HtmlPreview({ html, title }: { html: string; title: string }) {
  // 수 MB 문서를 렌더마다 훑지 않게 문서가 바뀔 때만 판정한다.
  const hasScripts = useMemo(() => htmlHasScripts(html), [html])
  const [allowedHtml, setAllowedHtml] = useState<string | null>(null)
  const scriptsAllowed = allowedHtml === html
  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      {hasScripts && !scriptsAllowed && (
        // 단추를 품은 안내라 role=status(라이브 영역)를 쓰지 않는다 — 열 때마다 낭독되는 알림이 아니라 고를 수 있는 단추다.
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground"
          data-testid="html-script-notice"
        >
          <Code className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-keep">이 문서에는 스크립트가 있어 원래 모습과 다르게 보일 수 있어요</span>
          <Button size="sm" variant="outline" onClick={() => setAllowedHtml(html)}>
            스크립트 실행
          </Button>
        </div>
      )}
      <SandboxedHtmlFrame
        data-testid="html-document"
        title={title}
        html={html}
        allowScripts={scriptsAllowed}
        className="block min-h-0 w-full flex-1 border-0"
      />
    </div>
  )
}
