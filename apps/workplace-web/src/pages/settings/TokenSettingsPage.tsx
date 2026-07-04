// 설정 > 개인 > API 토큰 — 외부 도구(Claude Code MCP 등)가 내 권한으로 API 를 호출할 때 쓰는
// 개인 PAT(Personal Access Token) 발급/목록/폐기. 발급 직후에만 평문이 1회 노출된다.

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
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useIssueMyToken, useMyTokens, useRevokeMyToken } from '../../hooks/queries/useUserTokens';
import { TokenIssueDialog } from './components/TokenIssueDialog';

// 시간 표시 공통 — null/빈값 폴백.
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR');
  } catch {
    return iso;
  }
}

export default function TokenSettingsPage() {
  const tokens = useMyTokens();
  const issue = useIssueMyToken();
  const revoke = useRevokeMyToken();

  const [name, setName] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  // 파괴적 작업 확인 AlertDialog — window.confirm 대체(#136 패턴 재사용).
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const onIssue = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await issue.mutateAsync({ name: trimmed });
      setName('');
      setPlaintext(res.plaintextToken);
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  };

  const onRevoke = (id: number) => {
    setConfirmId(id);
  };

  const isEmpty = !tokens.isLoading && !tokens.isError && (tokens.data ?? []).length === 0;

  return (
    <SettingsPage title="API 토큰" width="form">
      {/* 발급 카드 — 다른 폼형 설정 페이지(프로필 등)와 동일한 Card 섹션 구조(#651).
          이름은 여러 토큰을 구분하기 위한 용도(prefix 만 노출되므로 필수). */}
      <Card>
        <CardHeader>
          <CardTitle>토큰 발급</CardTitle>
          <CardDescription>
            외부 도구(Claude Code 등)가 내 권한으로 접근할 때 쓰는 개인 토큰입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onIssue();
            }}
            className="flex gap-2"
            data-testid="token-issue-form"
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="token-name" className="sr-only">
                토큰 이름
              </Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="토큰 이름 (예: claude-code-mcp)"
                maxLength={80}
                aria-label="토큰 이름"
              />
            </div>
            <Button type="submit" disabled={issue.isPending || !name.trim()} data-testid="token-issue-submit">
              발급
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* 토큰 목록 카드 — prefix 만 노출(평문은 발급 직후 dialog 로만). */}
      <Card>
        <CardHeader>
          <CardTitle>발급된 토큰</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table aria-label="API 토큰 목록">
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>prefix</TableHead>
                  <TableHead>마지막 사용</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      로딩 중…
                    </TableCell>
                  </TableRow>
                ) : tokens.isError ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-destructive">
                      목록을 불러오지 못했습니다
                    </TableCell>
                  </TableRow>
                ) : isEmpty ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      발급된 토큰이 없습니다
                    </TableCell>
                  </TableRow>
                ) : (
                  (tokens.data ?? []).map((t) => (
                    <TableRow key={t.id} data-testid={`token-row-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {t.tokenPrefix}…
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateTime(t.lastUsedAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.revokedAt == null ? '활성' : `폐기됨(${fmtDateTime(t.revokedAt)})`}
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
        </CardContent>
      </Card>

      <TokenIssueDialog
        plaintextToken={plaintext}
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
