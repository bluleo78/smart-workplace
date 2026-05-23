// 색상 토큰 → Tailwind 클래스 정적 매핑.
// 모든 클래스 문자열은 인라인 리터럴이어야 Tailwind purge 가 추출할 수 있다.
// (동적 문자열 조립으로는 클래스가 빌드 결과에서 제거되니 절대 금지.)

import type { ColorToken } from '../types/label';

export const LABEL_COLORS: Record<ColorToken, { bg: string; text: string; dot: string }> = {
  GRAY: { bg: 'bg-slate-200 dark:bg-slate-700', text: 'text-slate-800 dark:text-slate-100', dot: 'bg-slate-500' },
  RED: { bg: 'bg-red-200 dark:bg-red-900', text: 'text-red-800 dark:text-red-100', dot: 'bg-red-500' },
  ORANGE: { bg: 'bg-orange-200 dark:bg-orange-900', text: 'text-orange-800 dark:text-orange-100', dot: 'bg-orange-500' },
  YELLOW: { bg: 'bg-yellow-200 dark:bg-yellow-900', text: 'text-yellow-800 dark:text-yellow-100', dot: 'bg-yellow-500' },
  GREEN: { bg: 'bg-green-200 dark:bg-green-900', text: 'text-green-800 dark:text-green-100', dot: 'bg-green-500' },
  TEAL: { bg: 'bg-teal-200 dark:bg-teal-900', text: 'text-teal-800 dark:text-teal-100', dot: 'bg-teal-500' },
  CYAN: { bg: 'bg-cyan-200 dark:bg-cyan-900', text: 'text-cyan-800 dark:text-cyan-100', dot: 'bg-cyan-500' },
  BLUE: { bg: 'bg-blue-200 dark:bg-blue-900', text: 'text-blue-800 dark:text-blue-100', dot: 'bg-blue-500' },
  INDIGO: { bg: 'bg-indigo-200 dark:bg-indigo-900', text: 'text-indigo-800 dark:text-indigo-100', dot: 'bg-indigo-500' },
  PURPLE: { bg: 'bg-purple-200 dark:bg-purple-900', text: 'text-purple-800 dark:text-purple-100', dot: 'bg-purple-500' },
  PINK: { bg: 'bg-pink-200 dark:bg-pink-900', text: 'text-pink-800 dark:text-pink-100', dot: 'bg-pink-500' },
  BROWN: { bg: 'bg-amber-200 dark:bg-amber-900', text: 'text-amber-900 dark:text-amber-100', dot: 'bg-amber-700' },
};
