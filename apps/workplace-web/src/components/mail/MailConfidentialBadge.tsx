// 받은 기밀 메일 배지(WP-2030) — 목록 행·상세 제목 옆에 「기밀」 을 보인다. 작성창 토글(WP-2029)과 같은 rose 색을 쓴다.
import { Lock } from 'lucide-react'

import { cn } from '@/lib/utils'

/** 「기밀」 배지 — 장식 아이콘은 스크린리더에서 뺀다(글자 「기밀」 이 이름). */
export function MailConfidentialBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="mail-confidential-badge"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-600 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
        className,
      )}
    >
      <Lock className="size-3" aria-hidden />
      기밀
    </span>
  )
}
