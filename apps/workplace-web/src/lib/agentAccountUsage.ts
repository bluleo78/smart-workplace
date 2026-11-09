// AI 계정 표(WP-1451)의 표시 규칙 — 상태 칸 판정, 사용률 막대 색, 초기화 시각·갱신 시각 문구를 한곳에서 정한다.
// 화면(AgentAccountsTab)과 이후 AI 상세의 계정 고르기가 같은 규칙을 쓰도록 순수 함수로 둔다. 시각은 서버의 ISO Instant 를 브라우저 시간대로 본다.
import type { StatusBadgeType } from '@/components/ui/status-badge';
import type { AccountUsage, AgentAccountResponse, UsageWindow } from '@/types/agentAccount';
import type { CredentialProvider } from '@/types/providerCredential';

import { formatRelativeTime, parseUtcDate, WEEKDAY_KO } from './formatters';

/** 상태 칸 하나 — 배지 문구·색, (확인 실패일 때) 이유. */
export interface AccountStatusPill {
  label: string;
  type: StatusBadgeType;
  reason: string | null;
}

/**
 * 상태 칸 판정. 우선순위(위가 먼저): 다시 로그인 필요(계정 또는 사용량) → 확인 필요(계정) → 확인 실패 → 한도 도달 → 곧 한도 →
 * 쓰는 AI 없음 → 여유(OK) → 정상(한도 없음) → 확인 전. 계정 상태가 사용량 상태보다 앞선다 — 다시 로그인이 먼저 할 일이다.
 */
export function accountStatusPill(account: Pick<AgentAccountResponse, 'status' | 'agents' | 'usage'>): AccountStatusPill {
  const usage = account.usage;
  const status = usage?.status ?? 'UNKNOWN';
  if (account.status === 'RELOGIN_REQUIRED' || status === 'RELOGIN_REQUIRED') {
    return { label: '다시 로그인 필요', type: 'error', reason: null };
  }
  // 옛 연결에서 옮겨 와 아직 확인 전인 로그인 계정 — 다시 로그인만큼 급하진 않지만 사용량보다 먼저 확인할 일이다.
  if (account.status === 'NEEDS_CHECK') return { label: '확인 필요', type: 'warning', reason: null };
  if (status === 'CHECK_FAILED') return { label: '확인 실패', type: 'warning', reason: usage?.errorMessage ?? null };
  if (status === 'LIMIT_REACHED') return { label: '한도 도달', type: 'error', reason: null };
  if (status === 'NEAR_LIMIT') return { label: '곧 한도', type: 'warning', reason: null };
  // 한도 문제가 없으면 「아무도 안 쓴다」가 더 쓸모 있는 정보다 — 지울지 다른 AI 에 묶을지 정하게.
  if (account.agents.length === 0) return { label: '쓰는 AI 없음', type: 'unknown', reason: null };
  if (status === 'OK') return { label: '여유', type: 'success', reason: null };
  if (status === 'UNLIMITED') return { label: '정상', type: 'success', reason: null };
  return { label: '확인 전', type: 'unknown', reason: null };
}

/** 한도를 조회하지 않는 종류 — OpenAI 호환·Gen:iA. 서버 UsageStatusCalculator 의 UNLIMITED 판정과 같다. */
const UNLIMITED_PROVIDERS: readonly CredentialProvider[] = ['opencode', 'genia'];

/** 한도 없는 줄인지 — 5시간·주간 칸에 「한도 없음」, 갱신 칸에 마지막 사용 시각을 보인다. */
export function isUnlimitedAccount(account: Pick<AgentAccountResponse, 'provider' | 'usage'>): boolean {
  return UNLIMITED_PROVIDERS.includes(account.provider) || account.usage?.status === 'UNLIMITED';
}

/** 막대 색 — 서버 「곧 한도」 기준(75%)과 같다. muted 는 초기화 시각이 지나 지금 값이 아닌 창. */
export type UsageBarTone = 'destructive' | 'warning' | 'primary' | 'muted';

/** 초기화 시각이 지난 창의 안내 — 지난 창의 % 는 이미 풀린 값이고 새 값은 다음 사용량 조회 때 온다. 5시간·주간이 같은 문구를 쓴다. */
export const WINDOW_RESET_TEXT = '초기화됨 · 다음 확인 때 갱신';

/** 「곧 한도」로 보는 사용률(%) — workplace-api application.yml 의 near-limit-percent(75)와 같게 둔다 — 바꾸면 함께 바꾼다. */
const NEAR_LIMIT_PERCENT = 75;

/**
 * 창별 막대 색 — 100% 이상 destructive, 75% 이상 warning, 그 밖 primary.
 * 초기화 시각이 이미 지난 창은 지난 창의 값이라 지금은 풀렸다(서버도 판정에서 뺀다) — 경고 색 없이 muted 로 흐리게 둔다.
 */
export function usageBarTone(window: Pick<UsageWindow, 'usedPercent' | 'resetsAt'>, now: Date = new Date()): UsageBarTone {
  if (isWindowReset(window, now)) return 'muted';
  if (window.usedPercent >= 100) return 'destructive';
  if (window.usedPercent >= NEAR_LIMIT_PERCENT) return 'warning';
  return 'primary';
}

/** 초기화 시각이 지났는지 — 시각이 없으면 모른다(false). 화면이 % 를 흐리게 그릴지 정할 때도 쓴다. */
export function isWindowReset(window: Pick<UsageWindow, 'resetsAt'>, now: Date): boolean {
  const resets = parseUtcDate(window.resetsAt);
  return !Number.isNaN(resets.getTime()) && resets.getTime() <= now.getTime();
}

/** 화면에 보일 사용률 — 내림한 정수 %(74.9 를 75 로 올려 「곧 한도」 기준과 어긋나 보이지 않게). 100 을 넘어도 그대로 보인다. */
export function formatUsedPercent(usedPercent: number): string {
  return `${Math.floor(usedPercent)}%`;
}

/** 막대 채움 폭(0~100) — 100 을 넘는 값도 막대는 가득까지만. */
export function usageBarWidth(usedPercent: number): number {
  return Math.min(100, Math.max(0, usedPercent));
}

/**
 * 5시간 창 초기화까지 남은 시간 — 「N시간 M분 뒤 초기화」, 1시간 미만은 「M분 뒤 초기화」, 지났으면 WINDOW_RESET_TEXT.
 * 분은 올림한다(30초 남음 = 「1분 뒤」). 정시면 「N시간 뒤 초기화」. 시각이 없거나 무효면 null.
 */
export function formatResetCountdown(resetsAt: string | null, now: Date = new Date()): string | null {
  const resets = parseUtcDate(resetsAt);
  if (Number.isNaN(resets.getTime())) return null;
  const diffMs = resets.getTime() - now.getTime();
  if (diffMs <= 0) return WINDOW_RESET_TEXT;
  const totalMin = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins}분 뒤 초기화`;
  return mins === 0 ? `${hours}시간 뒤 초기화` : `${hours}시간 ${mins}분 뒤 초기화`;
}

/**
 * 주간 창 초기화 날짜 — 브라우저 시간대의 「M/D (요일)」. 요일은 직접 계산한다(ICU 로케일 비의존). 시각이 없거나 무효면 null.
 * 이미 지났으면 지난 날짜 대신 WINDOW_RESET_TEXT(5시간 창과 같다).
 */
export function formatWeeklyReset(resetsAt: string | null, now: Date = new Date()): string | null {
  const d = parseUtcDate(resetsAt);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now.getTime()) return WINDOW_RESET_TEXT;
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_KO[d.getDay()]})`;
}

/**
 * 「갱신」 칸 문구. 한도 없는 줄은 마지막 사용 시각(「마지막 사용 3분 전」, 없으면 「사용 기록 없음」),
 * 한도 있는 줄은 마지막 조회 시각의 상대 시각(「2분 전」, 조회 전이면 null — 화면이 「—」).
 * now 는 같은 줄의 초기화 문구와 같은 시계를 쓰도록 화면이 넘긴다(한 줄을 한 시계로).
 */
export function refreshedText(usage: AccountUsage | null, unlimited: boolean, now: Date = new Date()): string | null {
  if (unlimited) {
    return usage?.lastUsedAt ? `마지막 사용 ${formatRelativeTime(usage.lastUsedAt, now)}` : '사용 기록 없음';
  }
  return usage?.checkedAt ? formatRelativeTime(usage.checkedAt, now) : null;
}
