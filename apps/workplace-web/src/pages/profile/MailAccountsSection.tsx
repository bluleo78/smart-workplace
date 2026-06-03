// 개인 메일 계정 목록 섹션 — 계정 추가/수정/삭제. ProfilePage 의 카드 섹션.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDeleteMailAccount, useMailAccounts } from '@/hooks/queries/useMailAccounts';
import type { MailAccountResponse } from '@/types/mailAccount';

import { MailAccountDialog } from './components/MailAccountDialog';

/** 개인 메일 계정 목록 + 추가/수정/삭제. ProfilePage 의 카드 섹션. */
export function MailAccountsSection() {
  const { data: accounts, isLoading } = useMailAccounts();
  const del = useDeleteMailAccount();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MailAccountResponse | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (acc: MailAccountResponse) => {
    setEditing(acc);
    setDialogOpen(true);
  };

  return (
    <Card data-testid="mail-accounts-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>메일 계정</CardTitle>
        <Button size="sm" onClick={openAdd} data-testid="mail-add-trigger">
          계정 추가
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
        {!isLoading && (accounts?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">연결된 메일 계정이 없습니다.</p>
        )}
        {accounts?.map((acc) => (
          <div
            key={acc.id}
            data-testid={`mail-account-row-${acc.id}`}
            className="flex items-center justify-between rounded border p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{acc.emailAddress}</p>
              <p className="truncate text-xs text-muted-foreground">
                {acc.imapHost} · {acc.lastTestedAt ? '연결됨' : '미검증'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => openEdit(acc)}>
                수정
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={del.isPending}
                onClick={() => del.mutate(acc.id)}
                data-testid={`mail-delete-${acc.id}`}
              >
                삭제
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      <MailAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} account={editing} />
    </Card>
  );
}
