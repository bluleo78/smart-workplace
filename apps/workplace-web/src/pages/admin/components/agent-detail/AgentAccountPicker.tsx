// AI 상세 「실행 › AI 계정」 — 작업 공간 실행 방식 AI 의 계정 고르기(WP-1451).
// 작업 공간 AI 는 AI 마다 연결 정보를 넣지 않고 워크스페이스 계정 목록(설정 › 에이전트 › 계정)에서 하나를 고른다.
// 지금 묶인 계정(라벨·종류·5시간/주간 사용률·상태)을 보이고, 「계정 고르기」/「바꾸기」가 이 방식에 맞는 종류(accountFits)의 계정만 고르는 창을 연다.
// 고르면 PUT /admin/agents/{id}/agent-account {accountId} — 실행 중이고 AI 가 쉬는 중(IDLE)이라고 보고하지 않았으면 서버가 쉴 때 새 계정으로
// 다시 띄우고(WP-1515, 작업 설정과 같은 「쉴 때 적용」), 꺼져 있거나 쉬는 중이면 바로 다시 시작한다. 창에 어느 쪽인지 안내를 둔다.
// 고른 계정이 없고 예전 방식(AI 별 연결)의 키가 남아 있으면 그 사실을 한 줄로 알린다 — 다시 넣는 UI 는 두지 않고 계정을 고르게 한다.
// 보기 전용(readOnly, 사용 중지된 AI)은 묶인 계정만 보이고 「계정 고르기」/「바꾸기」를 두지 않는다 — 다시 사용으로 바꾼 뒤에 고른다.
// 연결 해제(DELETE)는 두지 않는다 — 풀면 이 AI 는 일할 계정이 없어질 뿐이고, 계정 정리는 다른 계정으로 바꾸거나 실행 방식을 바꾸면 서버가 함께 푼다.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { LoadErrorState } from '@/components/LoadErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAgentAccounts, useAgentBoundAccount, useBindAgentAccount } from '@/hooks/queries/useAgentAccounts';
import { useAgentProviderCredentialMeta } from '@/hooks/queries/useAgentProviderCredential';
import { useMinuteNow } from '@/hooks/useMinuteNow';
import { accountFits, accountLabel } from '@/lib/agentAccount';
import { handleApiError } from '@/lib/api-error';
import { failedWithoutData } from '@/lib/queryFailure';
import { cn } from '@/lib/utils';
import type { AgentAccountResponse } from '@/types/agentAccount';
import type { CredentialProvider } from '@/types/providerCredential';

import { AccountStatusCell, AccountUsagePair } from '../AgentAccountUsageParts';

/**
 * 계정을 바꾸면 언제 새 계정으로 바뀌는지 안내(WP-1515).
 * 쉴 때 적용(accountAppliesAtIdle)이면 서버가 generation 만 올려 두고 쉴 때 다시 띄운다(하던 일은 옛 계정으로 마친다) — 바로 바꾸려면 상태의 「지금 적용」.
 * 상태가 차단됨이거나 아직 보고 전일 수도 있어 「일하는 중」이라 단정하지 않고 「하던 작업이 있으면」으로 쓴다.
 * 꺼져 있거나 쉬는 중이면 바로 새 계정으로 다시 시작한다.
 */
const ACCOUNT_SWITCH_NOTICE = {
  atIdle: '하던 작업이 있으면 마치고 쉴 때 새 계정으로 바뀌어요. 바로 바꾸려면 바꾼 뒤 「지금 적용」을 누르세요',
  now: '바꾸면 이 AI 의 작업 공간이 새 계정으로 다시 시작돼요',
} as const;

/** 계정 탭 주소 — 맞는 계정이 없을 때 먼저 추가하러 보낸다. */
const ACCOUNTS_TAB_PATH = '/settings/agents/accounts';

interface Props {
  agentUserId: number;
  /** 이 실행 방식(템플릿)이 쓰는 계정 종류. 보기 전용에서 방식 정의를 모르면 null — 종류 안내·어긋남 안내를 빼고 묶인 계정만 보인다. */
  required: CredentialProvider | null;
  /** 보기 전용 — 사용 중지된 AI. 고르기 단추·창 없이 묶인 계정(없으면 빈 줄)만 보인다. */
  readOnly?: boolean;
  /** 바꾸면 쉴 때 적용되는지(accountAppliesAtIdle) — 고르기 창의 안내를 「쉴 때 바뀜」/「바로 다시 시작」 중에서 고른다. */
  appliesAtIdle?: boolean;
}

/** 작업 공간 AI 의 계정 — 묶인 계정을 보이고, 보기 전용이 아니면 고르는 창을 연다. */
export function AgentAccountPicker({ agentUserId, required, readOnly = false, appliesAtIdle = false }: Props) {
  const bound = useAgentBoundAccount(agentUserId);
  // 예전 방식(AI 마다 넣은 연결, WP-1448 전) — 고른 계정이 없을 때 남아 있으면 알린다. runner 는 고른 계정이 없으면 이 연결로 일한다.
  // 고른 계정이 「없음」으로 확인됐을 때만 받는다 — 계정이 묶여 있으면 옛 연결은 보이지 않으니 부르지 않는다.
  const noBound = bound.isSuccess && bound.data == null;
  const legacy = useAgentProviderCredentialMeta(noBound ? agentUserId : null);
  const [open, setOpen] = useState(false);
  const account = bound.data ?? null;
  const legacyProvider = noBound ? (legacy.data?.provider ?? null) : null;
  // 남은 시간 계산 기준 — 1분마다 바뀌는 화면 시계(계정 탭과 같다).
  const { now } = useMinuteNow('minute');
  // 템플릿이 바뀌면 서버가 맞지 않는 묶음을 풀지만, 그 사이 낡은 응답이면 이 방식으로 일하지 못한다고 알린다.
  const mismatch = account != null && required != null && !fitsTemplate(account.provider, required);

  // 첫 조회 실패는 다시 시도하는 동안에도 안내를 둔다(failedWithoutData) — 그래서 「불러오는 중」보다 먼저 본다.
  if (failedWithoutData(bound)) {
    return <LoadErrorState variant="inline" title="고른 계정을 불러오지 못했어요" queries={[bound]} testId="agent-account-picker-error" className="items-start px-0 text-left" />;
  }
  if (bound.isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;

  return (
    <div className="space-y-3" data-testid="agent-account-picker">
      {account ? (
        <BoundAccount account={account} now={now} />
      ) : legacyProvider ? (
        // 고른 계정은 없지만 예전 방식의 키가 남아 있다 — 「계정 없음」으로 보이면 키가 사라진 줄 안다. 고르면 서버가 그 계정으로 바꾼다.
        <p className="text-sm text-muted-foreground" data-testid="agent-account-picker-legacy">
          예전 방식으로 연결된 {accountLabel(legacyProvider)} 키가 있어요
          {readOnly ? '' : ' — 계정을 고르면 그 계정으로 바뀝니다'}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="agent-account-picker-empty">
          {required != null && `이 방식은 ${accountLabel(required)} 계정으로 일해요. `}아직 고른 계정이 없습니다.
        </p>
      )}
      {mismatch && required != null && (
        <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning" data-testid="agent-account-picker-mismatch">
          이 방식은 {accountLabel(required)} 계정으로 일해요. 지금 계정으로는 일하지 못하니 바꿔 주세요.
        </p>
      )}
      {/* 보기 전용·방식 정의 모름이면 고르지 않는다 — 고를 종류(required)를 모르면 창이 맞는 계정을 거를 수 없다. */}
      {!readOnly && required != null && (
        <Button size="sm" variant={account && !mismatch ? 'outline' : 'default'} onClick={() => setOpen(true)} data-testid="agent-account-pick">
          {account ? '바꾸기' : '계정 고르기'}
        </Button>
      )}
      {/* 창을 열 때만 목록을 받는다 — 상세 화면에 머무는 동안 계정 목록을 60초마다 다시 받지 않게. */}
      {open && !readOnly && required != null && (
        <ChooseAccountDialog agentUserId={agentUserId} required={required} currentId={account?.id ?? null} appliesAtIdle={appliesAtIdle} now={now} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

/** 작업 공간 템플릿이 이 종류로 일하는지 — 공용 규칙 하나(accountFits)로 본다. */
function fitsTemplate(provider: CredentialProvider, required: CredentialProvider): boolean {
  return accountFits(provider, { mode: 'WORKSPACE', template: { account: required } });
}

/** 지금 묶인 계정 — 라벨·종류 배지·상태, 그 아래 5시간·주간 사용률(계정 탭과 같은 막대). */
function BoundAccount({ account, now }: { account: AgentAccountResponse; now: Date }) {
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="agent-account-bound">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-all" data-testid="agent-account-bound-label">
          {account.label}
        </span>
        <Badge variant="secondary">{accountLabel(account.provider)}</Badge>
        <AccountStatusCell account={account} />
      </div>
      {account.accountEmail && <p className="text-xs break-all text-muted-foreground">{account.accountEmail}</p>}
      <AccountUsagePair account={account} now={now} testIdOf={(part) => `agent-account-bound-${part}`} className="max-w-md" />
    </div>
  );
}

/**
 * 계정 고르는 창 — 이 방식에 맞는 종류의 계정만 줄로 보인다(각 줄에 5시간·주간 사용률, 상태, 이 계정을 쓰는 다른 AI 수).
 * now 는 부르는 쪽(AgentAccountPicker)의 화면 시계를 그대로 받는다 — 시계 하나로 지금 계정과 줄들의 남은 시간이 함께 움직이게.
 * 지금 계정과 다른 것을 골라야 「이 계정으로 바꾸기」가 열린다. 실패(409 작업 공간 아님·400 종류 안 맞음 등)는 서버 문구를 알리고 창은 남긴다.
 */
function ChooseAccountDialog({
  agentUserId,
  required,
  currentId,
  appliesAtIdle,
  now,
  onClose,
}: {
  agentUserId: number;
  required: CredentialProvider;
  currentId: number | null;
  appliesAtIdle: boolean;
  now: Date;
  onClose: () => void;
}) {
  const accounts = useAgentAccounts();
  const bind = useBindAgentAccount(agentUserId);
  const [picked, setPicked] = useState<number | null>(currentId);
  const fitting = (accounts.data ?? []).filter((a) => fitsTemplate(a.provider, required));
  const kind = `${accountLabel(required)} 계정`;

  const confirm = () => {
    if (picked == null) return;
    bind.mutate(picked, {
      onSuccess: (a) => {
        // 쉴 때 적용이면 아직 옛 계정으로 일한다 — 바뀐 시점을 오해하지 않게 쉴 때 적용된다고 덧붙인다(WP-1515).
        toast.success(`「${a.label}」 계정으로 바꿨습니다.${appliesAtIdle ? ' 쉴 때 적용돼요.' : ''}`);
        onClose();
      },
      onError: (e) => handleApiError(e, '계정을 바꾸지 못했습니다'),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="agent-account-choose-dialog">
        <DialogHeader>
          <DialogTitle>계정 고르기</DialogTitle>
          <DialogDescription>
            이 방식은 {kind}으로 일해요. 계정 목록에서 이 AI 가 쓸 계정을 고르세요.
          </DialogDescription>
        </DialogHeader>

        {/* 쉴 때 적용이면 바꿔도 바로 바뀌지 않는다는 점을 경고색으로, 아니면 다시 시작한다는 사실만 안내색으로(WP-1515). */}
        <p
          className={cn('rounded-md px-3 py-2 text-xs', appliesAtIdle ? 'bg-warning-subtle text-warning' : 'border border-info/30 bg-info/10 text-foreground')}
          data-testid="agent-account-switch-notice"
        >
          {appliesAtIdle ? ACCOUNT_SWITCH_NOTICE.atIdle : ACCOUNT_SWITCH_NOTICE.now}
        </p>

        {failedWithoutData(accounts) ? (
          <LoadErrorState variant="inline" title="계정 목록을 불러오지 못했습니다" queries={[accounts]} testId="agent-account-choose-error" />
        ) : accounts.isLoading ? (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        ) : fitting.length === 0 ? (
          <div className="space-y-2 text-sm" data-testid="agent-account-choose-empty">
            <p className="text-muted-foreground">고를 수 있는 {kind}이 없어요.</p>
            <Link to={ACCOUNTS_TAB_PATH} className="text-primary hover:underline" data-testid="agent-account-choose-add-link">
              계정 탭에서 먼저 추가
            </Link>
          </div>
        ) : (
          <RadioGroup
            value={picked != null ? String(picked) : ''}
            onValueChange={(v) => setPicked(Number(v))}
            aria-label="쓸 계정"
            className="max-h-[50vh] gap-2 overflow-y-auto"
          >
            {fitting.map((a) => (
              <AccountOption key={a.id} account={a} agentUserId={agentUserId} current={a.id === currentId} now={now} />
            ))}
          </RadioGroup>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={confirm} disabled={picked == null || picked === currentId || bind.isPending} data-testid="agent-account-choose-confirm">
            {bind.isPending ? '바꾸는 중…' : '이 계정으로 바꾸기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 고르는 줄 하나 — 라벨·종류·상태, 5시간·주간 사용률(한도 없는 계정은 「한도 없음」), 이 계정을 쓰는 다른 AI 수. */
function AccountOption({
  account: a,
  agentUserId,
  current,
  now,
}: {
  account: AgentAccountResponse;
  agentUserId: number;
  current: boolean;
  now: Date;
}) {
  const others = a.agents.filter((ag) => ag.userId !== agentUserId).length;
  const id = `agent-account-option-${a.id}`;
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[[data-state=checked]]:border-primary"
      data-testid={`agent-account-option-row-${a.id}`}
    >
      <RadioGroupItem id={id} value={String(a.id)} className="mt-0.5" data-testid={id} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{a.label}</span>
          <Badge variant="secondary">{accountLabel(a.provider)}</Badge>
          {current && <span className="text-xs text-muted-foreground">지금</span>}
          <AccountStatusCell account={a} />
        </div>
        <AccountUsagePair account={a} now={now} testIdOf={(part) => `agent-account-option-${part}-${a.id}`} />
        <p className="text-xs text-muted-foreground" data-testid={`agent-account-option-others-${a.id}`}>
          {others > 0 ? `다른 AI ${others}명이 써요` : '다른 AI 는 쓰지 않아요'}
        </p>
      </div>
    </label>
  );
}
