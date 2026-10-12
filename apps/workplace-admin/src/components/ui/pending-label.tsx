import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * 버튼 안 요청 중 라벨 — pending 이면 스피너(aria-hidden)와 pendingLabel, 아니면 label 을 보여준다.
 * 확인·복원·영구 삭제 등 여러 버튼이 같은 패턴을 쓰므로 한 곳에 모은다(WP-341 N6).
 */
export function PendingLabel({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean
  label: ReactNode
  pendingLabel: ReactNode
}) {
  if (!pending) return <>{label}</>
  return (
    <>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {pendingLabel}
    </>
  )
}
