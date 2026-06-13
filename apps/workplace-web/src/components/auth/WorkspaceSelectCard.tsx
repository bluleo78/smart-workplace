// src/components/auth/WorkspaceSelectCard.tsx
// 다중소속 로그인 직후 표시되는 워크스페이스 선택 카드.
// 선택 시 useAuth().selectTenant 호출 → tenant-scoped 토큰 재발급 + 루트 전체 리로드.
import { Building2 } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import type { Membership } from '../../types/auth';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export function WorkspaceSelectCard({ options }: { options: Membership[] }) {
  const { selectTenant } = useAuth();
  // 선택 진행 중인 tenantId(중복 클릭 방지 + 진행 표시)
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const onSelect = async (m: Membership) => {
    try {
      setError('');
      setPendingId(m.tenantId);
      await selectTenant(m); // 성공 시 전체 리로드 — 이후 코드 도달 안 함
    } catch {
      setPendingId(null);
      setError('워크스페이스 전환에 실패했습니다. 다시 시도해 주세요.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">워크스페이스 선택</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            접속할 워크스페이스를 선택하세요.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {options.map((m) => (
            <Button
              key={m.tenantId}
              type="button"
              variant="outline"
              data-testid={`workspace-option-${m.tenantId}`}
              disabled={pendingId !== null}
              onClick={() => onSelect(m)}
              className="h-auto w-full justify-start gap-3 py-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {m.tenantName}
              </span>
              {pendingId === m.tenantId && (
                <span className="text-xs text-muted-foreground">접속 중…</span>
              )}
            </Button>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
