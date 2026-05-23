// 라벨 칩 — 색상 도트 + 이름. small variant 는 보드 카드/리스트 셀용.

import { LABEL_COLORS } from '../../lib/labelColors';
import type { LabelSummary } from '../../types/label';

export function LabelChip({
  label,
  size = 'md',
}: {
  label: LabelSummary;
  size?: 'sm' | 'md';
}) {
  const c = LABEL_COLORS[label.colorToken];
  const padding = size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded ${padding} ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {label.name}
    </span>
  );
}
