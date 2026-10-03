// 드라이브 목록 행 <li> — 모바일에서 길게 누르기(다중 선택 진입)·선택 모드 중 탭(선택 토글)을 붙인다(WP-216).
// 행이 DrivePage 안에서 map 으로 인라인 렌더되므로, 행마다 길게 누르기 훅을 쓰려면 이렇게 컴포넌트로 감싸야 한다.
// 두 콜백이 모두 없으면(데스크톱) 핸들러 없는 평범한 <li> 다.
import type { ComponentProps } from 'react'

import { useLongPressCapture } from '@/hooks/useLongPressCapture'

export function DrivePressRow({
  onLongPress,
  onTap,
  ...props
}: ComponentProps<'li'> & { onLongPress?: () => void; onTap?: () => void }) {
  const bind = useLongPressCapture({ onLongPress, onTap })
  return <li {...props} {...bind} />
}
