// 개인 메일 계정 목록 — 풀폭 리스트(#674). 계정이 N개일 수 있는 스캔 목적 화면이라
// TokenSettingsPage(#655)를 참조 구현 삼아 bordered table 로 전환한다(카드 제거).
// 추가/수정 다이얼로그 상태는 MailSettingsPage 가 소유 — "계정 추가" 버튼을 헤더 actions 로 올리기 위함.

import { AiLabel } from '@/components/ai/AiLabel';
import { BusySwitch } from '@/components/BusySwitch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import {
  useDeleteMailAccount,
  useMailAccounts,
  useSetMailAiEnabled,
} from '@/hooks/queries/useMailAccounts';
import { formatRelativeTime } from '@/lib/formatters';
import { mailAccountProviderLabel } from '@/lib/mailAccountProvider';
import type { MailAccountResponse } from '@/types/mailAccount';

const COLUMN_COUNT = 5;

interface MailAccountsSectionProps {
  /** 수정 다이얼로그를 여는 콜백 — 상태는 MailSettingsPage 소유 */
  onEdit: (acc: MailAccountResponse) => void;
}

/** 개인 메일 계정 목록 + AI 전역 토글 + 수정/삭제. MailSettingsPage 의 풀폭 리스트 본문. */
export function MailAccountsSection({ onEdit }: MailAccountsSectionProps) {
  const { data: accounts, isLoading, isError } = useMailAccounts();
  const del = useDeleteMailAccount();
  const setAiEnabled = useSetMailAiEnabled();

  // 계정 중 하나 이상이 켜져 있으면 전역 토글 ON — some() 으로 현재 상태 반영.
  const globalAiEnabled = accounts?.some((a) => a.aiEnabled) ?? false;
  const hasAccounts = (accounts?.length ?? 0) > 0;
  const isEmpty = !isLoading && !isError && !hasAccounts;

  return (
    <div className="space-y-4" data-testid="mail-accounts-section">
      {/* 전역 개인 비서 토글 — 계정이 있을 때만 표시. AI 테마 적용. */}
      {hasAccounts && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg border border-ai-accent/30 bg-ai-accent-subtle px-4 py-3"
          data-testid="mail-ai-global-section"
        >
          <div className="space-y-1">
            <AiLabel className="cursor-pointer text-sm font-semibold leading-none">
              개인 비서 사용
            </AiLabel>
            <p className="text-xs text-muted-foreground">
              켜면 개인 비서가 모든 메일 계정을 개인 맞춤 요약하고, 회신 필요 여부·답장 초안을 돕습니다.
              <br />
              <span className="text-muted-foreground">(본문이 개인 비서 AI로 전송됩니다)</span>
            </p>
          </div>
          <BusySwitch
            id="mail-ai-global"
            data-testid="mail-ai-global"
            checked={globalAiEnabled}
            busy={setAiEnabled.isPending}
            onCheckedChange={(v) => setAiEnabled.mutate(v)}
          />
        </div>
      )}

      <div className="rounded-md border">
        <Table aria-label="메일 계정 목록">
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              {/* 좁은 화면은 공급자·마지막 동기화 열을 숨기고 이메일 아래 줄로 모은다 — 다섯 열이면 수정·삭제 버튼이 화면 밖으로 밀렸다(WP-686) */}
              <TableHead className="hidden md:table-cell">공급자</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="hidden md:table-cell">마지막 동기화</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeletonRows columns={COLUMN_COUNT} rows={3} />
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-destructive">
                  목록을 불러오지 못했습니다
                </TableCell>
              </TableRow>
            ) : isEmpty ? (
              <TableEmptyRow colSpan={COLUMN_COUNT} message="연결된 메일 계정이 없습니다." />
            ) : (
              (accounts ?? []).map((acc) => (
                <TableRow key={acc.id} data-testid={`mail-account-row-${acc.id}`}>
                  <TableCell className="max-w-[40vw] font-medium md:max-w-[280px]" title={acc.emailAddress}>
                    <div className="truncate">{acc.emailAddress}</div>
                    {/* 모바일 전용 — 숨긴 공급자·마지막 동기화 열의 값 */}
                    {/* 공급자는 길면 자르고 동기화 시각은 늘 보인다 */}
                    <div
                      className="flex gap-1 text-xs font-normal text-muted-foreground md:hidden"
                      data-testid={`mail-account-mobile-meta-${acc.id}`}
                    >
                      <span className="truncate">{mailAccountProviderLabel(acc)}</span>
                      <span className="shrink-0">· {formatRelativeTime(acc.lastSyncedAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell
                    className="hidden max-w-[220px] truncate text-xs text-muted-foreground md:table-cell"
                    title={mailAccountProviderLabel(acc)}
                  >
                    {mailAccountProviderLabel(acc)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={acc.lastTestedAt ? 'default' : 'secondary'}>
                      {acc.lastTestedAt ? '연결됨' : '미검증'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {formatRelativeTime(acc.lastSyncedAt)}
                  </TableCell>
                  <TableCell className="w-20 whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(acc)}>
                      수정
                    </Button>
                    {/* 삭제 확인 다이얼로그 — 즉시 실행 방지 (#182) */}
                    <DeleteConfirmDialog
                      entityName="메일 계정"
                      itemName={acc.emailAddress}
                      onConfirm={() => del.mutate(acc.id)}
                      description="이 계정과 동기화된 메일·일정이 모두 영구 삭제됩니다. 되돌릴 수 없습니다. 계속하시겠습니까?"
                      trigger={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={del.isPending}
                          data-testid={`mail-delete-${acc.id}`}
                        >
                          삭제
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
