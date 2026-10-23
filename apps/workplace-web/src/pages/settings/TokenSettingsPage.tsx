// 설정 > 개인 > API 토큰 — 외부 도구(Claude Code MCP 등)가 내 권한으로 API 를 호출할 때 쓰는
// 개인 PAT(Personal Access Token) 발급/목록/폐기. 발급 직후에만 평문이 1회 노출된다.
// 발급은 헤더 액션 버튼 → 입력 모달(TokenIssueFormDialog) → 결과 모달(TokenIssueDialog) 2단계.
// 다른 관리 목록(구성원/역할/감사 로그)과 동일하게 풀폭 + Card 없는 bordered table 을 쓴다(#655).
// 표 아래 「도구에 연결하기」 섹션은 발급 뒤에도 연결 방법을 다시 볼 수 있게 늘 보인다(WP-875, 발급 모달과 같은 TokenConnectGuide).

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
import { API_TOKEN_STATUS_LABEL, apiTokenStatus } from '@/lib/apiTokenStatus';
import { formatDateShort, formatDateTimeLocale } from '@/lib/formatters';

import { useIssueMyToken, useMyTokens, useRevokeMyToken } from '../../hooks/queries/useUserTokens';
import { TokenConnectGuide } from './components/TokenConnectGuide';
import { TokenIssueDialog } from './components/TokenIssueDialog';
import { TokenIssueFormDialog } from './components/TokenIssueFormDialog';

const COLUMN_COUNT = 6;

/** 만료 표시 — 만료일이 없으면 「무기한」. */
function expiryLabel(expiresAt: string | null): string {
  return expiresAt ? formatDateShort(expiresAt) : '무기한';
}

/**
 * 상태 배지 — 활성은 강조, 만료됨·폐기됨은 회색(WP-702: 만료일이 지난 토큰은 서버가 거절하므로 「활성」으로 보이면 안 된다).
 * 마우스를 올리면 만료·폐기 시각을 보인다.
 */
function TokenStatusBadge({ revokedAt, expiresAt }: { revokedAt: string | null; expiresAt: string | null }) {
  const status = apiTokenStatus({ revokedAt, expiresAt });
  const at = status === 'revoked' ? revokedAt : status === 'expired' ? expiresAt : null;
  return (
    <Badge variant={status === 'active' ? 'default' : 'secondary'} title={at ? formatDateTimeLocale(at) : undefined}>
      {API_TOKEN_STATUS_LABEL[status]}
    </Badge>
  );
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
              {/* 휴대폰(<md)에서는 앞자리·만료·마지막 사용 열을 숨기고 이름 아래 한 줄로 모은다(WP-617) — 여섯 열이 화면 밖으로 밀려
                  상태·「폐기」가 옆으로 밀어야만 보였다. 감사 로그 화면과 같은 hidden md:table-cell 방식. */}
              <TableHead className="hidden max-w-[200px] md:table-cell">앞자리</TableHead>
              <TableHead className="hidden md:table-cell">만료</TableHead>
              <TableHead className="hidden md:table-cell">마지막 사용</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="w-20"></TableHead>
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
                  <TableCell className="max-w-[45vw] md:max-w-[220px]">
                    <div className="truncate font-medium" title={t.name}>
                      {t.name}
                    </div>
                    <div
                      className="truncate text-xs text-muted-foreground md:hidden"
                      data-testid={`token-meta-${t.id}`}
                    >
                      <span className="font-mono">{t.tokenPrefix}…</span> · 만료 {expiryLabel(t.expiresAt)} · 사용{' '}
                      {formatDateShort(t.lastUsedAt)}
                    </div>
                  </TableCell>
                  <TableCell
                    className="hidden max-w-[200px] truncate font-mono text-xs text-muted-foreground md:table-cell"
                    title={t.tokenPrefix}
                  >
                    {t.tokenPrefix}…
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {expiryLabel(t.expiresAt)}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {formatDateShort(t.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    <TokenStatusBadge revokedAt={t.revokedAt} expiresAt={t.expiresAt} />
                  </TableCell>
                  {/* 액션 컬럼 — 고정폭 + 우측 정렬(디자인 가이드 04-components.md 패턴3, RoleListPage 관례) */}
                  <TableCell className="w-20 text-right">
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

      {/* 도구에 연결하기 — 토큰 값은 다시 보이지 않으므로 2단계는 「발급 때 복사한 토큰」으로 안내한다(WP-875).
          긴 명령이 풀폭으로 늘어지지 않게 읽기 좋은 폭으로 묶는다. */}
      <section
        aria-labelledby="token-connect-guide-title"
        className="mt-8 max-w-3xl space-y-3 border-t pt-6"
        data-testid="token-connect-guide"
      >
        <div className="space-y-1">
          <h2 id="token-connect-guide-title" className="text-base leading-6 font-semibold">
            도구에 연결하기
          </h2>
          <p className="text-sm text-muted-foreground">
            발급 때 나온 안내와 같습니다. 토큰은 다시 볼 수 없어요 — 발급 때 복사해 둔 토큰을 쓰고, 잃어버렸으면 새로 발급하세요.
          </p>
        </div>
        <p className="text-sm font-medium">Claude Code 에 연결</p>
        <TokenConnectGuide tokenSource="saved" testIdPrefix="connect-guide" />
      </section>

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
