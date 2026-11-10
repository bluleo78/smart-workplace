// AI 계정 표(WP-1451·1465)의 표시 규칙 — 상태 칸 판정·실패 이유, 사용률 막대 색, 빈 창 문구, 초기화 시각·사용량 확인·마지막 사용 문구를 한곳에서 정한다.
// 화면(AgentAccountsTab)과 이후 AI 상세의 계정 고르기가 같은 규칙을 쓰도록 순수 함수로 둔다. 시각은 서버의 ISO Instant 를 브라우저 시간대로 본다.
import type { StatusBadgeType } from '@/components/ui/status-badge';
import type { AccountUsage, AgentAccountResponse, UsageWindow } from '@/types/agentAccount';
import type { CredentialProvider } from '@/types/providerCredential';

import { EMPTY_GLYPH, formatRelativeTime, localClockParts, parseUtcDate, WEEKDAY_KO } from './formatters';

/** 상태 칸 하나 — 배지 문구·색, (마지막 사용량 조회가 실패했으면) 배지 아래 한 줄로 보일 이유. */
export interface AccountStatusPill {
  label: string;
  type: StatusBadgeType;
  reason: string | null;
}

/** 실패 이유 앞머리 — 「확인 필요」 배지 아래 줄이 「사용량 확인 실패 · 연결 실패」처럼 무엇이 실패했는지부터 말하게.
 * 「확인 실패」 배지는 이미 실패를 말하므로 붙이지 않는다(좁은 칸에서 이유가 잘리지 않게). */
const FAILURE_REASON_PREFIX = '사용량 확인 실패 · ';

/**
 * 상태 칸 판정. 우선순위(위가 먼저): 다시 로그인 필요(계정 또는 사용량) → 확인 필요(계정) → 확인 실패 → 한도 도달 → 곧 한도 →
 * 정상(OK·UNLIMITED) → 확인 전. 계정 상태가 사용량 상태보다 앞선다 — 다시 로그인이 먼저 할 일이다.
 * 「쓰는 AI 없음」은 상태가 아니다 — 쓰는 AI 칸이 「없음」으로 이미 보이므로 되풀이하지 않는다(WP-1465).
 */
export function accountStatusPill(account: Pick<AgentAccountResponse, 'status' | 'usage'>): AccountStatusPill {
  const usage = account.usage;
  const status = usage?.status ?? 'UNKNOWN';
  if (account.status === 'RELOGIN_REQUIRED' || status === 'RELOGIN_REQUIRED') {
    // 다시 로그인이 먼저다 — 조회 실패 이유는 로그인 뒤 다시 확인하면 바뀌니 보이지 않는다.
    return { label: '다시 로그인 필요', type: 'error', reason: null };
  }
  const reason = failureReason(usage);
  // 옛 연결에서 옮겨 와 아직 확인 전인 로그인 계정 — 다시 로그인만큼 급하진 않지만 사용량보다 먼저 확인할 일이다.
  // 마지막 사용량 조회가 실패했으면 배지가 그 실패를 가리지 않게 이유를 앞머리와 함께 보인다.
  if (account.status === 'NEEDS_CHECK') {
    return { label: '확인 필요', type: 'warning', reason: reason && `${FAILURE_REASON_PREFIX}${reason}` };
  }
  if (status === 'CHECK_FAILED') return { label: '확인 실패', type: 'warning', reason };
  if (status === 'LIMIT_REACHED') return { label: '한도 도달', type: 'error', reason: null };
  if (status === 'NEAR_LIMIT') return { label: '곧 한도', type: 'warning', reason: null };
  if (status === 'OK' || status === 'UNLIMITED') return { label: '정상', type: 'success', reason: null };
  return { label: '확인 전', type: 'unknown', reason: null };
}

/** 마지막 사용량 조회가 실패했고 이유 문구가 있을 때만 그 이유 — 옛 실패 문구가 남아 있어도 지금 실패가 아니면 null. */
function failureReason(usage: AccountUsage | null): string | null {
  if (usage?.status !== 'CHECK_FAILED' || !usage.errorMessage) return null;
  return usage.errorMessage;
}

/** 실제로 조회되지 않은 사용량 상태 — 이 상태면 창 값이 없어도 「값 없음」이라 말할 수 없다. */
const NOT_LOOKED_UP: readonly AccountUsage['status'][] = ['CHECK_FAILED', 'UNKNOWN', 'RELOGIN_REQUIRED'];

/**
 * 마지막 사용량 조회가 성공했는지 — 조회 시각이 있고, 사용량 상태가 실패·조회 전·다시 로그인이 아니며, 계정이 확인 필요·다시 로그인 필요가 아님.
 * 성공했는데 창 값이 없으면 서버가 그 창을 주지 않은 것이라 「값 없음」, 그 밖은 아직 모르는 것이라 「—」로 나눈다.
 */
function usageLookupSucceeded(account: Pick<AgentAccountResponse, 'status' | 'usage'>): boolean {
  const usage = account.usage;
  if (!usage?.checkedAt || NOT_LOOKED_UP.includes(usage.status)) return false;
  return account.status !== 'NEEDS_CHECK' && account.status !== 'RELOGIN_REQUIRED';
}

/** 창 값이 없을 때 사용량 칸 문구 — 조회는 됐는데 값이 없으면 「값 없음」, 확인 실패·확인 필요·조회 전이면 「—」. */
export function emptyWindowText(account: Pick<AgentAccountResponse, 'status' | 'usage'>): string {
  return usageLookupSucceeded(account) ? '값 없음' : EMPTY_GLYPH;
}

/** 한도를 조회하지 않는 종류 — OpenAI 호환·Gen:iA. 서버 UsageStatusCalculator 의 UNLIMITED 판정과 같다. */
const UNLIMITED_PROVIDERS: readonly CredentialProvider[] = ['opencode', 'genia'];

/** 한도 없는 줄인지 — 5시간·주간 칸을 합쳐 「한도 없음」 한 번, 사용량 확인 칸은 「—」(조회하지 않는다). */
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
 * 주간 창 초기화 시각 — 브라우저 시간대의 「M/D (요일) 오후 2:05 초기화」. 요일·오전/오후는 직접 계산한다(ICU 로케일 비의존 — localClockParts).
 * 날짜만 보이면 그날 언제 풀리는지 몰라 시각까지 보인다(WP-1465). 시각이 없거나 무효면 null.
 * 이미 지났으면 지난 날짜 대신 WINDOW_RESET_TEXT(5시간 창과 같다).
 */
export function formatWeeklyReset(resetsAt: string | null, now: Date = new Date()): string | null {
  const d = parseUtcDate(resetsAt);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now.getTime()) return WINDOW_RESET_TEXT;
  const { meridiem, clock } = localClockParts(d);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_KO[d.getDay()]}) ${meridiem} ${clock} 초기화`;
}

/**
 * 「사용량 확인」 칸 문구 — 마지막 조회 시각의 상대 시각(「2분 전」). 조회 전이거나 한도 없는 줄(조회하지 않는다)이면 null — 화면이 「—」.
 * now 는 같은 줄의 초기화 문구와 같은 시계를 쓰도록 화면이 넘긴다(한 줄을 한 시계로).
 */
export function checkedText(account: Pick<AgentAccountResponse, 'provider' | 'usage'>, now: Date = new Date()): string | null {
  const checkedAt = account.usage?.checkedAt;
  if (isUnlimitedAccount(account) || !checkedAt) return null;
  return formatRelativeTime(checkedAt, now);
}

/**
 * 쓰는 AI 칸 아래 줄 — 이 계정을 쓰는 AI 가 마지막으로 실행 중이던 시각(「마지막 사용 3분 전」). 모든 종류에 보인다.
 * 기록이 없으면 null — 화면이 줄을 생략한다.
 */
export function lastUsedText(usage: AccountUsage | null, now: Date = new Date()): string | null {
  return usage?.lastUsedAt ? `마지막 사용 ${formatRelativeTime(usage.lastUsedAt, now)}` : null;
}
