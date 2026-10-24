// 이슈 행의 레이블 메타 묶음(WP-919) — outline 칩 최대 max 개 + 넘친 개수 +N.
// 프로젝트 이슈 목록(WP-505)에서 뽑아 내 작업·개인 목록이 같은 규칙(개수·칩 모양·좁은 폭 숨김)을 쓰게 한다.

import { cn } from '../../lib/utils';
import type { LabelSummary } from '../../types/label';
import { LabelChip } from '../labels/LabelChip';

/**
 * 레이블 칩 묶음. 레이블이 없으면 아무것도 그리지 않는다.
 * - max: 보일 최대 칩 수 — 데스크톱 2, 개인 목록 모바일 1.
 * - collapse: 'container' 면 가장 가까운 @container 가 40rem 미만일 때 숨긴다(WP-505 — 제목 폭을 지키려고).
 *   'none' 이면 항상 보인다.
 * 칩 이름의 6rem 말줄임은 LabelChip outline 이 이미 갖고 있어 여기서 다시 주지 않는다.
 */
export function IssueLabelMeta({
  labels,
  max = 2,
  collapse = 'container',
  testId,
  className,
}: {
  labels: LabelSummary[];
  max?: number;
  collapse?: 'container' | 'none';
  testId?: string;
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <span
      className={cn(
        collapse === 'container' ? 'hidden items-center gap-1 @min-[40rem]:flex' : 'flex items-center gap-1',
        className,
      )}
      // 칩에 다 못 보인 레이블까지 hover 로 읽을 수 있게 전체 이름을 title 에 둔다.
      title={labels.map((l) => l.name).join(', ')}
      data-testid={testId}
    >
      {labels.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} size="sm" variant="outline" />
      ))}
      {labels.length > max && (
        <span className="text-xs font-normal text-muted-foreground">+{labels.length - max}</span>
      )}
    </span>
  );
}
