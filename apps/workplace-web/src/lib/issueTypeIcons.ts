// 이슈 유형 아이콘 — lucide-react 컴포넌트 정적 매핑.
// 컴포넌트 자체가 JSX 이므로 Tailwind purge 와 무관하다.

import {
  BookOpen,
  Bug,
  Circle,
  Flag,
  Star,
  Target,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { IconName } from '../types/issueType';

export const ISSUE_TYPE_ICONS: Record<IconName, LucideIcon> = {
  Circle,
  Bug,
  BookOpen,
  Wrench,
  Star,
  Zap,
  Flag,
  Target,
};
