// 접힌 근거 기록(WP-1511) — AI 가 답의 근거로 남긴 ```evidence 코드 펜스를 기본은 접어 두고, 펼치면 글 그대로 보여 준다.
import type { ReactNode } from 'react'

/** 근거 기록 접이. 펜스 안 글은 코드 블록과 같은 모양(pre)으로 담는다. */
export function EvidenceBlock({ children }: { children?: ReactNode }) {
  return (
    <details className="rounded bg-muted/50 px-2 py-1 text-xs">
      <summary className="cursor-pointer text-muted-foreground">근거 기록</summary>
      <pre className="mt-1 overflow-x-auto">{children}</pre>
    </details>
  )
}
