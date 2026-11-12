// 「매뉴얼에 없음」 칩(WP-1511) — AI 가 매뉴얼에 없는 내용을 보강해 답했음을 알린다. 글은 AI 가 쓴 링크 글과 무관하게 고정이다.
import { Badge } from '@/components/ui/badge'

/** 보강 표식 칩. */
export function ManualGapChip() {
  return <Badge variant="secondary">매뉴얼에 없음</Badge>
}
