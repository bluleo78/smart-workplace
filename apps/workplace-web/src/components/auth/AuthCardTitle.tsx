// 비로그인 화면(로그인·가입·워크스페이스 선택·SSO 완료) 카드의 대표 제목 — h1 로 그린다(WP-1429).
// shadcn CardTitle 은 div 고정이라 스크린리더 제목 탐색에 잡히지 않는다. components/ui 는 고치지 않으므로
// CardTitle 과 같은 data-slot·기본 클래스를 단 h1 을 여기 한 곳에 둔다 — 보이는 모양은 CardTitle 과 같다.
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/** 카드 머리의 화면 대표 제목(h1). 화면마다 하나만 쓴다. */
export function AuthCardTitle({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 data-slot="card-title" className={cn('leading-none font-semibold', className)} {...props} />
}
