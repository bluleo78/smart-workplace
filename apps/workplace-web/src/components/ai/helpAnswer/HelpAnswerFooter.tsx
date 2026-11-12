// AI 답의 바닥줄(WP-1511) — 답 끝의 출처 링크와 「매뉴얼에 없음」 칩을 본문에서 떼어 한 줄에 모은다(구분선 아래).
import type { HelpAnswerFooter as Footer } from './helpAnswer'
import { HelpSourceLink } from './HelpSourceLink'
import { ManualGapChip } from './ManualGapChip'

/** 바닥줄 — 출처·칩이 하나도 없으면 그리지 않는다. */
export function HelpAnswerFooter({ footer }: { footer: Footer }) {
  if (!footer.source && !footer.gap) return null
  return (
    <div data-testid="help-answer-footer" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs">
      {footer.source && <HelpSourceLink id={footer.source.id}>{footer.source.label}</HelpSourceLink>}
      {footer.gap && <ManualGapChip />}
    </div>
  )
}
