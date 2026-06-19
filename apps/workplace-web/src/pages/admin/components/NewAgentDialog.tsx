// 신규 AGENT 유저 추가 dialog — username/name/email 만 입력.
// 성공 시 close 하고 부모 페이지가 list invalidate 로 자동 갱신.

import { useState } from 'react';

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

import { useCreateAgent } from '../../../hooks/queries/useAgents';

interface NewAgentDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function NewAgentDialog({ open, onOpenChange }: NewAgentDialogProps) {
  const create = useCreateAgent();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // 입력값을 trim 후 mutate, 성공 시 폼 리셋 + dialog 닫기.
  // 실패는 hook 내부의 handleApiError 가 토스트 처리.
  const onSubmit = async () => {
    try {
      await create.mutateAsync({
        username: username.trim(),
        name: name.trim(),
        email: email.trim(),
      });
      setUsername('');
      setName('');
      setEmail('');
      onOpenChange(false);
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-agent-dialog">
        <DialogHeader>
          <DialogTitle>새 에이전트</DialogTitle>
          <DialogDescription className="sr-only">새 에이전트</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="agent-username">아이디</Label>
            <Input
              id="agent-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={50}
              aria-label="아이디"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-name">이름</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              aria-label="이름"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-email">이메일</Label>
            <Input
              id="agent-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="이메일"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={create.isPending}>
              생성
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
