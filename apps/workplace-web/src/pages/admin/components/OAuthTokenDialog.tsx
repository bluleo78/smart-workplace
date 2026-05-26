// AGENT OAuth 토큰 등록/재발급 다이얼로그.
// 사용자는 호스트의 `claude setup-token` 으로 발급한 토큰 문자열을 그대로 붙여넣는다.
// 저장 후 평문은 다시 표시되지 않으며, 재발급 시 기존 active 토큰은 자동 회수된다.
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRegisterAgentOAuthToken } from '@/hooks/queries/useAgentOAuthToken';
import { handleApiError } from '@/lib/api-error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentUserId: number;
  isReissue: boolean;
}

// 입력 → 길이 검증 → mutate → toast → 다이얼로그 닫기.
export function OAuthTokenDialog({
  open,
  onOpenChange,
  agentUserId,
  isReissue,
}: Props) {
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const mutation = useRegisterAgentOAuthToken(agentUserId);

  const reset = () => {
    setToken('');
    setLabel('');
  };

  const submit = async () => {
    const trimmed = token.trim();
    // 백엔드 검증과 정합 (@Size(min = 32))
    if (trimmed.length < 32) {
      toast.error('토큰이 너무 짧습니다 (최소 32자)');
      return;
    }
    try {
      await mutation.mutateAsync({
        token: trimmed,
        label: label.trim() || undefined,
      });
      toast.success(
        isReissue ? 'OAuth 토큰을 재발급했습니다.' : 'OAuth 토큰을 등록했습니다.',
      );
      reset();
      onOpenChange(false);
    } catch (e) {
      handleApiError(e, '토큰 등록에 실패했습니다');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isReissue ? 'OAuth 토큰 재발급' : 'OAuth 토큰 등록'}
          </DialogTitle>
          <DialogDescription>
            호스트에서 <code>claude setup-token</code> 으로 발급한 토큰을 붙여넣으세요.
            저장 후 토큰은 다시 표시되지 않습니다.
            {isReissue ? ' 기존 토큰은 자동으로 회수됩니다.' : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oauth-token">토큰</Label>
            <Textarea
              id="oauth-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="sk-ant-oat..."
              className="font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oauth-label">레이블 (선택)</Label>
            <Input
              id="oauth-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="main"
              maxLength={80}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? '저장 중…' : isReissue ? '재발급' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
