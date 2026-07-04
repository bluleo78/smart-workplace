// 설정 > 개인 > API 토큰 — 외부 도구(Claude Code MCP 등)가 내 권한으로 API 를 호출할 때 쓰는
// 개인 PAT(Personal Access Token) 발급/목록/폐기. 발급 직후에만 평문이 1회 노출된다.
// 발급은 헤더 액션 버튼 → 입력 모달(TokenIssueFormDialog) → 결과 모달(TokenIssueDialog) 2단계.
// 다른 관리 목록(구성원/역할/감사 로그)과 동일하게 풀폭 + Card 없는 bordered table 을 쓴다(#655).

import { useState } from 'react';

import { SettingsPage } from '@/components/layout/SettingsPage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

import { useIssueMyToken, useMyTokens, useRevokeMyToken } from '../../hooks/queries/useUserTokens';
import { TokenIssueDialog } from './components/TokenIssueDialog';
import { TokenIssueFormDialog } from './components/TokenIssueFormDialog';

const COLUMN_COUNT = 6;

// 시간 표시 공통 — null/빈값 폴백. 전체 일시는 title 툴팁으로만 노출(테이블 폭 오버플로 방지 — #655).
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

// 컬럼에 표시하는 짧은 날짜(시각 생략) — 전체 일시는 title 로 확인.
function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('ko-KR');
  } catch {
    return iso;
  }
}

export default function TokenSettingsPage() {
  const tokens = useMyTokens();
  const issue = useIssueMyToken();
  const revoke = useRevokeMyToken();

  const [issueFormOpen, setIssueFormOpen] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [issuedExpiresAt, setIssuedExpiresAt] = useState<string | null>(null);
  // 파괴적 작업 확인 AlertDialog — window.confirm 대체(#136 패턴 재사용).
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const onIssueSubmit = async (input: { name: string; expiresAt: string | null }) => {
    const res = await issue.mutateAsync(input);
    setIssueFormOpen(false);
    setIssuedExpiresAt(res.expiresAt);
    setPlaintext(res.plaintextToken);
  };

  const onRevoke = (id: number) => {
    setConfirmId(id);
  };

  const isEmpty = !tokens.isLoading && !tokens.isError && (tokens.data ?? []).length === 0;

  return (
    <SettingsPage
      title="API 토큰"
      width="full"
      actions={
        <Button data-testid="token-issue-open" onClick={() => setIssueFormOpen(true)}>
          토큰 발급
        </Button>
      }
    >
      <div className="rounded-md border">
        <Table aria-label="API 토큰 목록">
          <TableHeader>
            <TableRow>
              <TableHead className="max-w-[220px]">이름</TableHead>
              <TableHead className="max-w-[200px]">prefix</TableHead>
              <TableHead>만료</TableHead>
              <TableHead>마지막 사용</TableHead>
              <TableHead>상태</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.isLoading ? (
              <TableSkeletonRows columns={COLUMN_COUNT} rows={3} />
            ) : tokens.isError ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-destructive">
                  목록을 불러오지 못했습니다
                </TableCell>
              </TableRow>
            ) : isEmpty ? (
              <TableEmptyRow colSpan={COLUMN_COUNT} message="발급된 토큰이 없습니다." />
            ) : (
              (tokens.data ?? []).map((t) => (
                <TableRow key={t.id} data-testid={`token-row-${t.id}`}>
                  <TableCell className="max-w-[220px] truncate font-medium" title={t.name}>
                    {t.name}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate font-mono text-xs text-muted-foreground"
                    title={t.tokenPrefix}
                  >
                    {t.tokenPrefix}…
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.expiresAt ? fmtDate(t.expiresAt) : '무기한'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDate(t.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={t.revokedAt == null ? 'default' : 'secondary'}
                      title={t.revokedAt == null ? undefined : fmtDateTime(t.revokedAt)}
                    >
                      {t.revokedAt == null ? '활성' : '폐기됨'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {t.revokedAt == null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevoke(t.id)}
                        data-testid={`token-revoke-${t.id}`}
                      >
                        폐기
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TokenIssueFormDialog
        open={issueFormOpen}
        onOpenChange={setIssueFormOpen}
        onSubmit={onIssueSubmit}
        isPending={issue.isPending}
      />

      <TokenIssueDialog
        plaintextToken={plaintext}
        expiresAt={issuedExpiresAt}
        open={plaintext != null}
        onOpenChange={(v) => {
          if (!v) setPlaintext(null);
        }}
      />

      {/* 폐기 확인 AlertDialog — window.confirm 대체(#136 패턴). */}
      <AlertDialog
        open={confirmId != null}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null);
        }}
      >
        <AlertDialogContent data-testid="token-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>API 토큰 폐기</AlertDialogTitle>
            <AlertDialogDescription>
              이 토큰을 폐기하시겠습니까? 이 토큰을 사용하는 외부 도구는 즉시 접근이 차단됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="token-confirm-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmId != null) revoke.mutate(confirmId);
              }}
              data-testid="token-confirm-confirm"
            >
              폐기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
