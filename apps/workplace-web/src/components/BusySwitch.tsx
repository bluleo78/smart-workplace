import type { ComponentProps } from 'react'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/**
 * 저장 중에도 키보드 초점을 잃지 않는 스위치(WP-847).
 *
 * 연타로 요청 순서가 엇갈리지 않게 저장하는 동안 스위치를 `disabled` 로 잠갔더니, 초점이 있던 스위치가 꺼지는 순간
 * 브라우저가 초점을 body 로 보내 키보드·스크린리더 사용자가 바뀐 상태를 듣지 못하고 처음부터 다시 찾아가야 했다.
 * `busy` 동안은 `disabled` 대신 `aria-disabled`·`aria-busy` 로 알리고 바꾸기만 무시한다 — 초점은 그대로 남는다.
 * 값은 늘 `checked` 로 제어한다는 전제다(무시한 바꾸기가 화면에 남지 않도록). 불러오기 전처럼 정말 쓸 수 없는 때는 `disabled` 를 그대로 쓴다.
 */
export function BusySwitch({
  busy = false,
  onCheckedChange,
  className,
  ...props
}: ComponentProps<typeof Switch> & { busy?: boolean }) {
  return (
    <Switch
      {...props}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={cn(busy && 'cursor-progress opacity-50', className)}
      onCheckedChange={(checked) => {
        if (!busy) onCheckedChange?.(checked)
      }}
    />
  )
}
