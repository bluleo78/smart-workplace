// 드라이브 목록 행 <li> — 모바일에서 길게 누르기(다중 선택 진입)·선택 모드 중 탭(선택 토글)을 붙인다(WP-216).
// 행이 DrivePage 안에서 map 으로 인라인 렌더되므로, 행마다 길게 누르기·드래그 훅을 쓰려면 이렇게 컴포넌트로 감싸야 한다.
// 두 콜백이 모두 없으면(데스크톱) 길게 누르기 핸들러는 붙지 않는다.
// dragItem 이 있으면 끌어 옮기기(WP-364) 행 — 파일은 드래그 소스, 폴더는 드롭 대상도 겸한다. DriveDndProvider 가 꺼져 있으면
// (모바일·터치·읽기 전용) 드래그 속성 없는 평범한 행이다. dragItem 이 없는 행(검색 결과)은 dnd 훅을 아예 쓰지 않는다.
import type { ComponentProps } from 'react'

import { useLongPressCapture } from '@/hooks/useLongPressCapture'
import type { DriveDragItem } from '@/lib/driveDnd'

import { DriveFileDragRow, DriveFolderDragRow } from './DriveDnd'

export function DrivePressRow({
  onLongPress,
  onTap,
  dragItem,
  ...props
}: ComponentProps<'li'> & { onLongPress?: () => void; onTap?: () => void; dragItem?: DriveDragItem }) {
  // 길게 누르기(bind, 모바일)와 끌기(데스크톱 마우스)는 같은 isMobile 조건으로 갈려 함께 켜지지 않는다 —
  // 둘 다 onPointerDown 을 쓰므로 조건을 바꿔 겹치게 되면 핸들러를 합쳐야 한다.
  const bind = useLongPressCapture({ onLongPress, onTap })
  if (!dragItem) return <li {...props} {...bind} />
  const Row = dragItem.kind === 'folder' ? DriveFolderDragRow : DriveFileDragRow
  return <Row item={dragItem} {...props} {...bind} />
}
