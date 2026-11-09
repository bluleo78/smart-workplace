// 에이전트 화면 「계정」 탭(WP-1451) — 워크스페이스의 AI 계정 목록. 계정마다 5시간·주간 사용률, 쓰는 AI, 상태, 갱신 시각을 한 표에 보인다.
// 넓은 화면은 표, 좁은 화면(md 미만)은 계정 칸 하나에 나머지 값을 쌓아 줄마다 카드처럼 보인다(실행 환경 탭과 같은 방식).
// 목록은 60초마다 다시 받고(useAgentAccounts), 「N분 전」·「N시간 M분 뒤 초기화」는 1분마다 도는 화면 시계(useMinuteNow)로 계산한다. 표시 규칙은 lib/agentAccountUsage.
// 추가 창은 머리 「+ 계정 추가」(createOpen)가, 수정 창·삭제 확인은 줄 끝 ⋯ 메뉴가 연다(좁은 폭도 같은 메뉴 칸). 쓰는 AI 가 있는 계정 삭제는 서버가 409 로 막는다.

import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { LoadErrorState } from '@/components/LoadErrorState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { useAgentAccounts, useDeleteAgentAccount } from '@/hooks/queries/useAgentAccounts';
import { useMinuteNow } from '@/hooks/useMinuteNow';
import { accountLabel } from '@/lib/agentAccount';
import { isUnlimitedAccount, refreshedText } from '@/lib/agentAccountUsage';
import { extractApiErrorCode, handleApiError, isConflictError } from '@/lib/api-error';
import { EMPTY_GLYPH } from '@/lib/formatters';
import { failedWithoutData } from '@/lib/queryFailure';
import type { AgentAccountBoundAgent, AgentAccountResponse } from '@/types/agentAccount';

import { AgentAccountDialog } from './AgentAccountDialog';
import { AccountStatusCell, AccountUsageCell, AccountUsagePair } from './AgentAccountUsageParts';

/** 쓰는 AI 칸에 이름을 보일 최대 수 — 넘으면 「외 N명」(실행 환경 탭과 같다). 좁은 폭에서 줄이 넘치지 않게. */
const MAX_AGENT_CHIPS = 3;

/** 표 열 수 — 로딩·빈 행의 colSpan(마지막은 ⋯ 메뉴 칸). */
const COLUMNS = 7;

/** 쓰는 AI 가 있는 계정 삭제 거절(409) 코드 — 서버 AgentAccountInUseException.CODE. */
const IN_USE_CODE = 'AGENT_ACCOUNT_IN_USE';

/** 쓰는 AI 가 있어 삭제가 막혔을 때 안내. */
const IN_USE_MESSAGE = '쓰는 AI 에서 먼저 다른 계정으로 바꿔 주세요';

interface Props {
  /** 머리 「+ 계정 추가」로 여는 창 — 단추는 페이지 머리(AgentManagementPage)에 있다. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

export function AgentAccountsTab({ createOpen, onCreateOpenChange }: Props) {
  const accounts = useAgentAccounts();
  const remove = useDeleteAgentAccount();
  // 고칠 계정 — null 이면 닫힘. 추가는 머리 단추(createOpen)가 연다.
  const [editing, setEditing] = useState<AgentAccountResponse | null>(null);
  // 삭제를 확인할 계정 — null 이면 확인 창 닫힘.
  const [deleting, setDeleting] = useState<AgentAccountResponse | null>(null);
  // 줄의 시계 — 1분마다 바뀌는 「지금」(useMinuteNow 가 setInterval 로 갱신·정리). 받은 시각(dataUpdatedAt)을 쓰면 다시 받기가 멈추거나
  // 실패할 때(창이 뒤에 있음·오류) 남은 시간이 굳는다. 초기화 문구와 「갱신」 상대 시각이 같은 now 를 써 한 줄이 한 시계로 움직인다.
  const { now } = useMinuteNow('minute');
  const rows = accounts.data ?? [];

  // 삭제 — 성공하면 확인 창을 닫고 알린다. 쓰는 AI 가 있으면(409 AGENT_ACCOUNT_IN_USE) 옮길 곳을 안내, 그 밖은 서버 문구.
  const confirmDelete = (a: AgentAccountResponse) =>
    remove.mutate(a.id, {
      onSuccess: () => {
        setDeleting(null);
        toast.success('계정을 삭제했습니다.');
      },
      onError: (e) => {
        setDeleting(null);
        if (isConflictError(e) && extractApiErrorCode(e) === IN_USE_CODE) toast.error(IN_USE_MESSAGE);
        else handleApiError(e, '계정을 삭제하지 못했습니다');
      },
    });

  return (
    <>
      <div className="rounded-md border">
        <Table aria-label="AI 계정 목록">
          <TableHeader>
            <TableRow>
              <TableHead>계정</TableHead>
              {/* 좁은 화면은 아래 열을 숨기고 계정 칸 아래로 모은다. */}
              <TableHead className="hidden md:table-cell">5시간</TableHead>
              <TableHead className="hidden md:table-cell">주간</TableHead>
              <TableHead className="hidden md:table-cell">쓰는 AI</TableHead>
              <TableHead className="hidden md:table-cell">상태</TableHead>
              <TableHead className="hidden md:table-cell">갱신</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">메뉴</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* 첫 조회 실패는 다시 시도하는 동안에도 안내를 둔다(failedWithoutData) — 받은 줄이 있으면 다시 받기가 실패해도 줄을 그대로 둔다. */}
            {failedWithoutData(accounts) ? (
              <TableRow>
                <TableCell colSpan={COLUMNS}>
                  <LoadErrorState title="계정 목록을 불러오지 못했습니다" queries={[accounts]} testId="agent-account-error" />
                </TableCell>
              </TableRow>
            ) : accounts.isLoading ? (
              <TableSkeletonRows columns={COLUMNS} rows={3} />
            ) : rows.length === 0 ? (
              <TableEmptyRow colSpan={COLUMNS} message="아직 계정이 없어요. 「+ 계정 추가」로 AI 가 쓸 계정을 넣으세요." />
            ) : (
              rows.map((a) => (
                <AccountRow key={a.id} account={a} now={now} onEdit={() => setEditing(a)} onDelete={() => setDeleting(a)} />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {(createOpen || editing != null) && (
        <AgentAccountDialog
          account={editing}
          onClose={() => {
            setEditing(null);
            onCreateOpenChange(false);
          }}
        />
      )}

      <DeleteConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        entityName="계정"
        itemName={deleting?.label ?? ''}
        description={`「${deleting?.label ?? ''}」 계정을 삭제해요. 되돌릴 수 없어요.`}
        impact={deleting && deleting.agents.length > 0 ? `이 계정을 쓰는 AI 가 ${deleting.agents.length}명 있어요 — ${IN_USE_MESSAGE}.` : null}
        contentTestId="agent-account-delete-dialog"
        confirmTestId="agent-account-delete-confirm"
        onConfirm={() => deleting && confirmDelete(deleting)}
      />
    </>
  );
}

/** 계정 한 줄 — 넓은 화면은 칸마다, 좁은 화면은 계정 칸 안에 같은 값을 쌓는다. 끝 칸의 ⋯ 메뉴(수정·삭제)는 두 폭 모두 보인다. */
function AccountRow({
  account: a,
  now,
  onEdit,
  onDelete,
}: {
  account: AgentAccountResponse;
  now: Date;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const unlimited = isUnlimitedAccount(a);
  const refreshed = refreshedText(a.usage, unlimited, now) ?? EMPTY_GLYPH;

  // 상태 칸 — 넓은 표의 칸과 좁은 폭 카드가 같은 것을 쓴다(확인 실패 이유는 보조 문구로도).
  const status = <AccountStatusCell account={a} />;

  return (
    <TableRow data-testid={`agent-account-row-${a.id}`} className="align-top">
      <TableCell className="min-w-0 whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{a.label}</span>
          <Badge variant="secondary">{accountLabel(a.provider)}</Badge>
        </div>
        {a.accountEmail && <p className="mt-0.5 text-xs break-all text-muted-foreground">{a.accountEmail}</p>}
        {/* 좁은 화면 전용 — 숨긴 열의 값을 카드처럼 쌓는다. */}
        <div className="mt-2 space-y-2 md:hidden" data-testid={`agent-account-meta-${a.id}`}>
          {status}
          <AccountUsagePair account={a} now={now} />
          {a.agents.length > 0 && <AgentChips agents={a.agents} />}
          <p className="text-xs text-muted-foreground">{refreshed}</p>
        </div>
      </TableCell>
      <TableCell className="hidden w-40 md:table-cell" data-testid={`agent-account-five-hour-${a.id}`}>
        <AccountUsageCell account={a} kind="fiveHour" now={now} />
      </TableCell>
      <TableCell className="hidden w-40 md:table-cell" data-testid={`agent-account-weekly-${a.id}`}>
        <AccountUsageCell account={a} kind="weekly" now={now} />
      </TableCell>
      <TableCell className="hidden whitespace-normal md:table-cell" data-testid={`agent-account-agents-${a.id}`}>
        {a.agents.length > 0 ? <AgentChips agents={a.agents} /> : <span className="text-xs text-muted-foreground">{EMPTY_GLYPH}</span>}
      </TableCell>
      <TableCell className="hidden max-w-48 whitespace-normal md:table-cell" data-testid={`agent-account-status-${a.id}`}>
        {status}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground md:table-cell" data-testid={`agent-account-refreshed-${a.id}`}>
        {refreshed}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${a.label} 메뉴`} data-testid={`agent-account-menu-${a.id}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit} data-testid={`agent-account-edit-${a.id}`}>
              수정
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete} data-testid={`agent-account-delete-${a.id}`}>
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

/** 쓰는 AI — 이름 칩(상세로 가는 링크). 셋이 넘으면 「외 N명」. 칩은 줄을 넘기고 긴 이름은 자른다. */
function AgentChips({ agents }: { agents: AgentAccountBoundAgent[] }) {
  const shown = agents.slice(0, MAX_AGENT_CHIPS);
  const rest = agents.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((ag) => (
        <Link
          key={ag.userId}
          to={`/settings/agents/${ag.userId}`}
          title={ag.name}
          className="max-w-32 truncate rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent"
        >
          {ag.name}
        </Link>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">외 {rest}명</span>}
    </div>
  );
}
