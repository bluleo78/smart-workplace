// 신규 AGENT 유저 추가 dialog — username/name/email 만 입력.
// 성공 시 close 하고 부모 페이지가 list invalidate 로 자동 갱신.
// 검증은 zod(newAgentSchema)가 칸 아래 한국어 오류로, 서버 거절은 창 위쪽 오류 줄로 보인다(WP-1559).

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { extractApiError } from '@/lib/api-error';
import { type NewAgentFormData, newAgentSchema } from '@/lib/validations/agent';

import { useCreateAgent } from '../../../hooks/queries/useAgents';

interface NewAgentDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function NewAgentDialog({ open, onOpenChange }: NewAgentDialogProps) {
  const create = useCreateAgent();
  const [serverError, setServerError] = useState('');
  // 요청이 끝났을 때 창이 아직 열려 있는지 — 진행 중에 닫았으면 창 안 오류 줄은 보이지 않으므로 토스트로 알리고,
  // 숨은 상태에 남아 다음에 열 때 지난 오류가 뜨지 않게 한다.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewAgentFormData>({
    resolver: zodResolver(newAgentSchema),
    defaultValues: { username: '', name: '', email: '' },
  });

  // 닫힐 때 값·오류·서버 오류 줄을 비운다 — 다시 열면 빈 폼이어야 한다.
  // (인자 없는 reset() 이 defaultValues 전체로 되돌린다.)
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setServerError('');
    }
    onOpenChange(next);
  };

  // 스키마를 통과한 값(이미 trim 됨)을 mutate. 성공하면 닫고, 실패는 창 안 오류 줄로 보이며 창을 유지한다.
  const onSubmit = async (data: NewAgentFormData) => {
    setServerError('');
    try {
      await create.mutateAsync(data);
      handleOpenChange(false);
    } catch (e) {
      const message = extractApiError(e, '에이전트 추가에 실패했습니다');
      if (openRef.current) setServerError(message);
      else toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* 「새 에이전트를 만든다」 도움말 절로 잇는다(WP-1507) — 열린 대화상자가 포커스보다 앞서므로 안쪽 칸에는 따로 달지 않는다. */}
      <DialogContent data-testid="new-agent-dialog" data-help="agents.list.create">
        <DialogHeader>
          <DialogTitle>새 에이전트</DialogTitle>
          <DialogDescription className="sr-only">새 에이전트</DialogDescription>
        </DialogHeader>
        {/* noValidate — type=email 의 브라우저 기본 검증이 먼저 막아 말풍선만 뜨고 화면에 문구가 남지 않던 것을 막는다. 검증은 zod 가 한다. */}
        <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-3">
          {serverError && (
            <p role="alert" className="text-sm text-destructive" data-testid="new-agent-error">
              {serverError}
            </p>
          )}
          {/* FormField 가 칸 아래 오류(role=alert)와 aria-invalid·aria-describedby(<id>-error)를 잇는다 */}
          <FormField label="아이디" htmlFor="agent-username" error={errors.username?.message}>
            <Input id="agent-username" maxLength={50} aria-label="아이디" {...register('username')} />
          </FormField>
          <FormField label="이름" htmlFor="agent-name" error={errors.name?.message}>
            {/* 저장 한도(user.name 50자)와 같게 — 100 이면 51자부터 서버가 거절했다(WP-670). */}
            <Input id="agent-name" maxLength={50} aria-label="이름" {...register('name')} />
          </FormField>
          <FormField label="이메일" htmlFor="agent-email" error={errors.email?.message}>
            <Input id="agent-email" type="email" aria-label="이메일" {...register('email')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
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
