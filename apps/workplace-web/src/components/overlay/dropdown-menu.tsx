// 앱 공용 DropdownMenu — shadcn ui/dropdown-menu 를 그대로 내보내되 메뉴·하위 메뉴 내용만 하단 탭바를 피하게 감싼다(WP-806).
// 왜 감싸나: overlay/popover.tsx 머리말과 같다(ui/* 직접 수정 금지·뒤집기는 숫자 충돌 여백으로만 가능).
import type { ComponentProps } from 'react'

import {
  DropdownMenuContent as UiDropdownMenuContent,
  DropdownMenuSubContent as UiDropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { useTabBarCollisionPadding } from '@/lib/mobileTabBar'

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** 메뉴 내용 — 모바일 하단 탭바가 보이면 탭바를 화면 아래 끝처럼 피한다(탭바가 없으면 원래 그대로). */
export function DropdownMenuContent({ collisionPadding, ...props }: ComponentProps<typeof UiDropdownMenuContent>) {
  return <UiDropdownMenuContent collisionPadding={useTabBarCollisionPadding(collisionPadding)} {...props} />
}

/** 하위 메뉴 내용 — 위와 같은 이유로 탭바를 피한다. */
export function DropdownMenuSubContent({ collisionPadding, ...props }: ComponentProps<typeof UiDropdownMenuSubContent>) {
  return <UiDropdownMenuSubContent collisionPadding={useTabBarCollisionPadding(collisionPadding)} {...props} />
}
