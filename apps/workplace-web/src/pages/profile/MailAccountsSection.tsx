// 개인 메일 계정 목록 섹션 — 계정 추가/수정/삭제. MailSettingsPage 의 카드 섹션.

import { useState } from 'react';

import { AiLabel } from '@/components/ai/AiLabel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  useDeleteMailAccount,
  useMailAccounts,
  useSetMailAiEnabled,
} from '@/hooks/queries/useMailAccounts';
import type { MailAccountResponse } from '@/types/mailAccount';

/** 공급자 라벨 — IMAP은 IMAP 호스트, M365_GRAPH는 'Outlook (Microsoft 365)' */
function providerLabel(acc: MailAccountResponse): string {
  if (acc.provider === 'M365_GRAPH') return 'Outlook (Microsoft 365)';
  return acc.imapHost || 'IMAP';
}

import { MailAccountDialog } from './components/MailAccountDialog';

/** 개인 메일 계정 목록 + 추가/수정/삭제. ProfilePage 의 카드 섹션. */
export function MailAccountsSection() {
  const { data: accounts, isLoading } = useMailAccounts();
  const del = useDeleteMailAccount();
  const setAiEnabled = useSetMailAiEnabled();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MailAccountResponse | null>(null);

  // 계정 중 하나 이상이 켜져 있으면 전역 토글 ON — some() 으로 현재 상태 반영.
  const globalAiEnabled = accounts?.some((a) => a.aiEnabled) ?? false;
  const hasAccounts = (accounts?.length ?? 0) > 0;

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
      <CardContent className="space-y-4">
        {/* 전역 개인 비서 토글 — 계정이 있을 때만 표시. AI 테마 적용. */}
        {hasAccounts && (
          <>
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
                  <span className="text-muted-foreground/70">(본문이 개인 비서 AI로 전송됩니다)</span>
                </p>
              </div>
              <Switch
                id="mail-ai-global"
                data-testid="mail-ai-global"
                checked={globalAiEnabled}
                disabled={setAiEnabled.isPending}
                onCheckedChange={(v) => setAiEnabled.mutate(v)}
              />
            </div>
            <Separator />
          </>
        )}

        {/* 계정 목록 */}
        <div className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
          {!isLoading && !hasAccounts && (
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
                  {/* M365_GRAPH는 'Outlook' 라벨, IMAP는 호스트 주소 표시 */}
                  {providerLabel(acc)} · {acc.lastTestedAt ? '연결됨' : '미검증'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => openEdit(acc)}>
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
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <MailAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editing}
        defaultAiEnabled={globalAiEnabled}
      />
    </Card>
  );
}
