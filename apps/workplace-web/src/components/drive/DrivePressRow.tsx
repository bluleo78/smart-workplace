// 드라이브 목록 행 <li> — 모바일에서 길게 누르기(다중 선택 진입)·선택 모드 중 탭(선택 토글)을 붙인다(WP-216).
// 행이 DrivePage 안에서 map 으로 인라인 렌더되므로, 행마다 길게 누르기·드래그 훅을 쓰려면 이렇게 컴포넌트로 감싸야 한다.
// 두 콜백이 모두 없으면(데스크톱) 길게 누르기 핸들러는 붙지 않는다.
// dragItem 이 있으면 끌어 옮기기(WP-364) 소스가 되고, 폴더면 드롭 대상도 겸한다 — DriveDndProvider 가 꺼져 있으면(모바일·터치·읽기 전용) 평범한 행.
import type { ComponentProps } from 'react'

import { useLongPressCapture } from '@/hooks/useLongPressCapture'
import type { DriveDragItem } from '@/lib/driveDnd'
import { cn } from '@/lib/utils'

import { useDriveRowDnd } from './DriveDnd'

export function DrivePressRow({
  onLongPress,
  onTap,
  dragItem,
  className,
  ...props
}: ComponentProps<'li'> & { onLongPress?: () => void; onTap?: () => void; dragItem?: DriveDragItem }) {
  const bind = useLongPressCapture({ onLongPress, onTap })
  const { setNodeRef, props: dndProps, className: dndClass, dropState } = useDriveRowDnd(dragItem)
  return (
    <li
      ref={setNodeRef}
      {...props}
      {...bind}
      {...dndProps}
      data-drop-state={dropState === 'idle' ? undefined : dropState}
      className={cn(className, dndClass)}
    />
  )
}
