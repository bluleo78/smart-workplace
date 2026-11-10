// 에이전트 화면 「계정」 탭(WP-1451·1465) — 워크스페이스의 AI 계정 목록. 칸: 계정 · 유형 · 5시간 · 주간 · 쓰는 AI(+마지막 사용) · 상태(+실패 이유) · 사용량 확인 · 메뉴.
// 넓은 화면은 칸 너비를 고정 비율로 둔 표, 좁은 화면(md 미만)은 계정 칸 하나에 나머지 값을 쌓아 줄마다 카드처럼 보인다(실행 환경 탭과 같은 방식).
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
import { checkedText, lastUsedText } from '@/lib/agentAccountUsage';
import { extractApiErrorCode, handleApiError, isConflictError } from '@/lib/api-error';
import { EMPTY_GLYPH } from '@/lib/formatters';
import { failedWithoutData } from '@/lib/queryFailure';
import type { AgentAccountBoundAgent, AgentAccountResponse } from '@/types/agentAccount';

import { AgentAccountDialog } from './AgentAccountDialog';
import { AccountStatusCell, AccountUsagePair, AccountUsageTableCells } from './AgentAccountUsageParts';

/** 쓰는 AI 칸에 이름을 보일 최대 수 — 넘으면 「외 N명」(실행 환경 탭과 같다). 좁은 폭에서 줄이 넘치지 않게. */
const MAX_AGENT_CHIPS = 3;

/** 표 열 수 — 로딩·빈·오류 행의 colSpan(계정·유형·5시간·주간·쓰는 AI·상태·사용량 확인·⋯ 메뉴). */
const COLUMNS = 8;

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
  // 실패할 때(창이 뒤에 있음·오류) 남은 시간이 굳는다. 초기화 문구·「사용량 확인」·「마지막 사용」 상대 시각이 같은 now 를 써 한 줄이 한 시계로 움직인다.
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
        {/* 아주 넓은 화면(xl)만 칸 너비를 고정 비율로(table-fixed) — 긴 이름·이유가 옆 칸을 밀지 않게.
            그보다 좁은 표(md~lg, 본문 폭 700px 안팎)에서 고정 비율이면 유형 배지가 옆 칸을 덮어, 유형 칸을 숨기고(배지는 이름 옆) 자동 배치로 둔다.
            break-keep — 한글 낱말 가운데서 줄이 끊기지 않게(「초기 / 화」). */}
        <Table aria-label="AI 계정 목록" className="break-keep xl:table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="xl:w-[16%]">계정</TableHead>
              {/* 좁은 화면은 아래 열을 숨기고 계정 칸 아래로 모은다. */}
              {/* 유형 14% — 가장 긴 배지(「ChatGPT 로그인」 약 106px)가 xl 시작 폭(1280, 표 약 970px)에서도 칸 안(여백 빼고)에 들게. */}
              <TableHead className="hidden xl:table-cell xl:w-[14%]">유형</TableHead>
              <TableHead className="hidden md:table-cell xl:w-[12%]">5시간</TableHead>
              <TableHead className="hidden md:table-cell xl:w-[15%]">주간</TableHead>
              <TableHead className="hidden md:table-cell xl:w-[18%]">쓰는 AI</TableHead>
              <TableHead className="hidden md:table-cell xl:w-[14%]">상태</TableHead>
              <TableHead className="hidden md:table-cell xl:w-[8%]">사용량 확인</TableHead>
              {/* 메뉴 칸은 비율(3%) 대신 고정 폭 — 좁은 표에서 3% 는 ⋯ 단추(36px)보다 좁아진다. */}
              <TableHead className="w-14">
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
  // 사용량 확인 — 한도 없는 줄(조회하지 않음)·조회 전이면 null. 넓은 표는 「—」, 좁은 카드는 줄을 생략한다.
  const checked = checkedText(a, now);
  // 쓰는 AI 칸 아래 마지막 사용 — 카드와 넓은 표가 같은 값을 쓴다.
  const lastUsed = lastUsedText(a.usage, now);
  const typeBadge = <Badge variant="secondary">{accountLabel(a.provider)}</Badge>;

  // 상태 칸 — 넓은 표의 칸과 좁은 폭 카드가 같은 것을 쓴다(실패 이유 한 줄까지).
  const status = <AccountStatusCell account={a} />;

  return (
    <TableRow data-testid={`agent-account-row-${a.id}`} className="align-top">
      {/* 계정 칸은 라벨만 — 로그인 계정의 이메일은 수정 창에서 본다(WP-1465). */}
      <TableCell className="min-w-0 whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          {/* 한글은 낱말 단위로 줄을 바꾸고(표의 break-keep), 띄어쓰기 없는 긴 이름(이메일 등)만 아무 데서나 끊는다. */}
          <span className="font-medium [overflow-wrap:anywhere]">{a.label}</span>
          {/* xl 미만 전용 — 유형 칸이 숨으니 종류 배지를 이름 옆에. */}
          <span className="xl:hidden" data-testid={`agent-account-type-badge-${a.id}`}>
            {typeBadge}
          </span>
        </div>
        {/* 좁은 화면 전용 — 숨긴 열의 값을 카드처럼 쌓는다. */}
        <div className="mt-2 space-y-2 md:hidden" data-testid={`agent-account-meta-${a.id}`}>
          {status}
          <AccountUsagePair account={a} now={now} />
          <AgentsSummary agents={a.agents} lastUsed={lastUsed} emptyText="쓰는 AI 없음" />
          {checked && <p className="text-xs text-muted-foreground">사용량 확인 {checked}</p>}
        </div>
      </TableCell>
      <TableCell className="hidden xl:table-cell" data-testid={`agent-account-type-${a.id}`}>
        {typeBadge}
      </TableCell>
      {/* 한도 없는 종류는 5시간·주간 두 칸을 합쳐 「한도 없음」을 한 번만 — 같은 말을 두 칸에 되풀이하지 않는다. */}
      <AccountUsageTableCells account={a} now={now} testIdOf={(part) => `agent-account-${part}-${a.id}`} />
      <TableCell className="hidden whitespace-normal md:table-cell" data-testid={`agent-account-agents-${a.id}`}>
        <AgentsSummary agents={a.agents} lastUsed={lastUsed} emptyText="없음" />
      </TableCell>
      <TableCell className="hidden whitespace-normal md:table-cell" data-testid={`agent-account-status-${a.id}`}>
        {status}
      </TableCell>
      <TableCell className="hidden text-xs whitespace-normal text-muted-foreground md:table-cell" data-testid={`agent-account-checked-${a.id}`}>
        {checked ?? EMPTY_GLYPH}
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

/**
 * 쓰는 AI 칸 — 이름 칩(없으면 emptyText), 그 아래 「마지막 사용 N분 전」(기록이 없으면 줄 생략). 모든 종류에 같은 모양.
 * 쓰는 AI 가 없으면 마지막 사용 줄도 뺀다 — 「없음」 아래 사용 시각이 있으면 아직 누가 쓰는 것처럼 읽힌다.
 * 넓은 표는 칸 머리말이 있어 「없음」, 좁은 카드는 머리말이 없어 「쓰는 AI 없음」을 넘긴다.
 */
function AgentsSummary({
  agents,
  lastUsed,
  emptyText,
}: {
  agents: AgentAccountBoundAgent[];
  lastUsed: string | null;
  emptyText: string;
}) {
  return (
    <div className="space-y-1">
      {agents.length > 0 ? (
        <>
          <AgentChips agents={agents} />
          {lastUsed && <p className="text-xs text-muted-foreground">{lastUsed}</p>}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
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
