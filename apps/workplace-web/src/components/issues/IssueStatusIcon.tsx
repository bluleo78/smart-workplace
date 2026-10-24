// 이슈 상태 아이콘 — 할일/진행/완료/취소를 모양으로, 상태 색으로 구분(팀·개인 공통).
// 아이콘 전용이라 접근성 위해 한글 라벨을 aria-label/title 로 노출(role=img).
// 모양은 범주(status)로 정하고, 색은 상태 색(color, WP-809 — 범주 기본 색·없음이면 범주 시맨틱 색)으로 정한다.
// 읽어 주는 이름은 프로젝트 상태 이름(name, WP-808)이 있으면 그것을 쓴다.
import { Circle, CircleCheckBig, CircleDashed, CircleX } from 'lucide-react';

import { statusLabel } from '@/lib/issueGrouping';
import { statusIconClass } from '@/lib/projectStatuses';
import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types/issue';

export function IssueStatusIcon({
  status,
  className,
  decorative,
  name,
  color,
}: {
  status: IssueStatus;
  /** 프로젝트 상태 이름(응답 statusName) — 없으면 범주 라벨을 읽는다. */
  name?: string;
  /** 상태 색 토큰(ProjectStatus.color·응답 statusColor) — 없으면 범주 색. */
  color?: string | null;
  className?: string;
  // 인접 텍스트(필터 칩/드롭다운 옵션 라벨)와 중복 announce 방지 — true 면 aria-label 대신
  // aria-hidden 만 설정해 순수 장식으로 처리한다 (#657).
  decorative?: boolean;
}) {
  const cls = cn('h-[18px] w-[18px] shrink-0', className, statusIconClass(status, color));
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': `상태: ${statusLabel(status, name)}` };
  switch (status) {
    case 'DONE':
      return <CircleCheckBig className={cls} {...a11yProps} />;
    case 'IN_PROGRESS':
      return <CircleDashed className={cls} {...a11yProps} />;
    case 'CANCELED':
      return <CircleX className={cls} {...a11yProps} />;
    default:
      return <Circle className={cls} {...a11yProps} />;
  }
}
