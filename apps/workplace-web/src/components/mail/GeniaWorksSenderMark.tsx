// src/components/mail/GeniaWorksSenderMark.tsx
// WP-1364: Gen:iA Works 에서 보낸 메일의 보낸 사람 옆에 붙는 작은 회색 표시.
// 아는 사람만 알아채는 은근한 표지라 눈에 띄지 않게(14px·muted) 두고, 설명은 툴팁(터치는 탭 팝오버)·접근 이름으로만 준다.
// 터치에서는 호버 툴팁이 열리지 않으므로 공용 IconHint(WP-991 — 마우스 툴팁·터치 팝오버, 탭 영역 확장)를 쓴다.
// 받은 메일 목록 행에는 쓰지 않는다(상세 헤더 전용).
import { Boxes } from 'lucide-react'

import { IconHint } from '@/components/ui/icon-hint'

const LABEL = 'Gen:iA Works에서 보낸 메일'

/** sentByGeniaWorks 가 true 일 때만 그린다. */
export function GeniaWorksSenderMark({ sentByGeniaWorks }: { sentByGeniaWorks?: boolean }) {
  if (!sentByGeniaWorks) return null
  return (
    <IconHint label={LABEL} data-testid="mail-genia-mark">
      <Boxes role="img" aria-label={LABEL} className="h-3.5 w-3.5 text-muted-foreground" />
    </IconHint>
  )
}
