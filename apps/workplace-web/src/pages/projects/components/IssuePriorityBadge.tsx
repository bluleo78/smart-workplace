// 이슈 우선순위 배지 — LOW/MID/HIGH 한국어 라벨 + variant 매핑.

import { Badge } from '@/components/ui/badge';

import type { IssuePriority } from '../../../types/issue';

const PRIORITY_LABEL: Record<IssuePriority, string> = {
  LOW: '낮음',
  MID: '보통',
  HIGH: '높음',
};

const PRIORITY_VARIANT: Record<IssuePriority, 'default' | 'secondary' | 'destructive'> = {
  LOW: 'secondary',
  MID: 'default',
  HIGH: 'destructive',
};

export function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}
