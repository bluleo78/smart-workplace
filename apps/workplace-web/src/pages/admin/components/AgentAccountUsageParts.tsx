// AI 계정 사용량 표시 조각(WP-1451) — 계정 탭의 표와 AI 상세의 계정 고르기가 같은 막대·상태 배지를 쓰도록 한곳에 둔다.
// 판정(상태 우선순위·막대 색·초기화 문구)은 lib/agentAccountUsage 의 순수 함수가 하고, 여기는 그 결과를 그리기만 한다.

import { StatusBadge } from '@/components/ui/status-badge';
import {
  accountStatusPill,
  formatResetCountdown,
  formatUsedPercent,
  formatWeeklyReset,
  isUnlimitedAccount,
  type UsageBarTone,
  usageBarTone,
  usageBarWidth,
} from '@/lib/agentAccountUsage';
import { EMPTY_GLYPH } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { AgentAccountResponse } from '@/types/agentAccount';

/** 막대 색 → 채움 클래스(시맨틱 토큰만). */
const TONE_CLASS: Record<UsageBarTone, string> = {
  destructive: 'bg-destructive',
  warning: 'bg-warning',
  primary: 'bg-primary',
  // 초기화 시각이 지난 창 — 지난 값이라 경고 색 없이 흐리게.
  muted: 'bg-muted-foreground/40',
};

/** 사용량 창 종류 — 사용량 응답(usage)의 키와 같다. */
type UsageKind = 'fiveHour' | 'weekly';

/** 사용량 칸 종류 → 보일 이름. 막대의 접근성 이름과 짝 칸의 머리말이 같은 말을 쓴다. */
const KIND_NAME: Record<UsageKind, string> = { fiveHour: '5시간', weekly: '주간' };

/**
 * 사용량 칸 — 한도 없는 계정은 「한도 없음」, 아직 값이 없으면 「—」, 있으면 % + 막대 + 초기화 문구
 * (5시간은 「N시간 M분 뒤 초기화」, 주간은 「M/D (요일)」). 초기화 시각이 지난 창은 % 를 흐리게, 문구는 「초기화됨 · 다음 확인 때 갱신」.
 * 계정을 통째로 받아 한도 없음·창 값을 여기서 꺼낸다 — 부르는 곳(계정 탭·계정 고르기)마다 같은 꺼내기를 되풀이하지 않게.
 */
export function AccountUsageCell({
  account,
  kind,
  now,
}: {
  account: Pick<AgentAccountResponse, 'provider' | 'usage'>;
  kind: UsageKind;
  now: Date;
}) {
  if (isUnlimitedAccount(account)) return <span className="text-xs text-muted-foreground">한도 없음</span>;
  const window = account.usage?.[kind] ?? null;
  if (!window) return <span className="text-muted-foreground">{EMPTY_GLYPH}</span>;
  const tone = usageBarTone(window, now);
  const reset = kind === 'fiveHour' ? formatResetCountdown(window.resetsAt, now) : formatWeeklyReset(window.resetsAt, now);
  // 지난 창 — 보이는 % 는 초기화 전 값이다. 지우지 않되(마지막으로 잰 값) 지금 값이 아님을 흐림으로 알린다. 막대 색 판정(muted)과 같은 기준.
  const stale = tone === 'muted';
  const width = usageBarWidth(window.usedPercent);
  return (
    <div className="flex flex-col gap-1">
      <span className={cn('text-sm tabular-nums', stale && 'text-muted-foreground')} data-stale={stale || undefined}>
        {formatUsedPercent(window.usedPercent)}
      </span>
      <div
        role="progressbar"
        aria-label={`${KIND_NAME[kind]} 사용률`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(width)}
        data-tone={tone}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full', TONE_CLASS[tone])} style={{ width: `${width}%` }} />
      </div>
      {reset && <span className="text-xs text-muted-foreground">{reset}</span>}
    </div>
  );
}

/**
 * 5시간·주간 사용량 두 칸을 머리말과 함께 나란히 — 계정 탭의 좁은 폭 카드, AI 상세의 지금 계정, 계정 고르는 창의 줄이 같은 배치를 쓴다.
 * testIdOf 를 주면 칸마다 그 이름을 단다(인자는 'five-hour'·'weekly') — 부르는 곳마다 이름 모양(접두·접미 위치)이 달라 함수로 받는다.
 */
export function AccountUsagePair({
  account,
  now,
  testIdOf,
  className,
}: {
  account: Pick<AgentAccountResponse, 'provider' | 'usage'>;
  now: Date;
  testIdOf?: (part: 'five-hour' | 'weekly') => string;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {(['fiveHour', 'weekly'] as const).map((kind) => (
        <div key={kind} data-testid={testIdOf?.(kind === 'fiveHour' ? 'five-hour' : 'weekly')}>
          <p className="text-xs text-muted-foreground">{KIND_NAME[kind]}</p>
          <AccountUsageCell account={account} kind={kind} now={now} />
        </div>
      ))}
    </div>
  );
}

/** 상태 칸 — 배지 하나, 확인 실패면 이유를 배지 title 과 보조 문구로(title 은 터치에서 안 보이니 둘 다). */
export function AccountStatusCell({ account }: { account: Pick<AgentAccountResponse, 'status' | 'agents' | 'usage'> }) {
  const pill = accountStatusPill(account);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <StatusBadge type={pill.type} title={pill.reason ?? undefined}>
        {pill.label}
      </StatusBadge>
      {pill.reason && <span className="line-clamp-2 text-xs text-muted-foreground">{pill.reason}</span>}
    </div>
  );
}
