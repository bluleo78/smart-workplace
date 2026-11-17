// 앱 공용 Popover — shadcn ui/popover 를 그대로 내보내되 PopoverContent 만 하단 탭바를 피하게 감싼다(WP-806).
// 왜 감싸나: ui/* 는 shadcn CLI 산출물이라 직접 고치지 않는다. 팝오버가 탭바 위로 뒤집히려면 위치 계산(floating-ui)에
// 숫자 충돌 여백이 들어가야 해서 CSS 만으로는 안 된다. 앱 코드는 이 모듈에서 가져온다(eslint no-restricted-imports 가 지킨다).
import type { ComponentProps } from 'react'

import { PopoverContent as UiPopoverContent } from '@/components/ui/popover'
import { preventDismissOnExtensionUi } from '@/lib/browserExtensionUi'
import { useTabBarCollisionPadding } from '@/lib/mobileTabBar'

export {
  Popover,
  PopoverAnchor,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * 팝오버 내용 — 모바일 하단 탭바가 보이면 탭바를 화면 아래 끝처럼 피한다(탭바가 없으면 원래 그대로).
 * 토스트 단추·비밀번호 관리자 메뉴 누름은 바깥 클릭으로 보지 않는다 — Dialog·Sheet 와 같은 규칙.
 * 예: 알림 창에서 보관한 뒤 토스트 「되돌리기」를 누르면 창이 닫혀 돌아온 알림이 보이지 않았다(WP-1689).
 */
export function PopoverContent({
  collisionPadding,
  onInteractOutside,
  ...props
}: ComponentProps<typeof UiPopoverContent>) {
  return (
    <UiPopoverContent
      collisionPadding={useTabBarCollisionPadding(collisionPadding)}
      onInteractOutside={(event) => {
        onInteractOutside?.(event)
        preventDismissOnExtensionUi(event)
      }}
      {...props}
    />
  )
}
