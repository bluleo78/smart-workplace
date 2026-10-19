// 라벨 칩 — 색상 도트 + 이름. small variant 는 보드 카드/리스트 셀용.
// outline variant 는 배경 없이 테두리+도트만 — 이슈 목록 행처럼 소속 칩(채움)보다 약하게 보여야 하는 곳용(WP-505).

import { LABEL_COLORS } from '../../lib/labelColors';
import type { LabelSummary } from '../../types/label';

export function LabelChip({
  label,
  size = 'md',
  variant = 'filled',
}: {
  label: LabelSummary;
  size?: 'sm' | 'md';
  variant?: 'filled' | 'outline';
}) {
  const c = LABEL_COLORS[label.colorToken];
  const padding = size === 'sm' ? 'px-1.5 py-0 text-xs' : 'px-2 py-0.5 text-xs';
  const outline = variant === 'outline';
  const tone = outline
    ? 'rounded-full border border-border font-normal text-muted-foreground'
    : `rounded ${c.bg} ${c.text}`;
  return (
    <span className={`inline-flex items-center gap-1 ${padding} ${tone}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
      {/* outline 은 이름을 6rem 에서 말줄임 — 레이블이 행의 제목·소속 칩 폭을 잡아먹지 않게. */}
      {outline ? <span className="max-w-[6rem] truncate">{label.name}</span> : label.name}
    </span>
  );
}
