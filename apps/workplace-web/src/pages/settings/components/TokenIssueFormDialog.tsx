// API 토큰 발급 입력 모달 — 이름 + 유효기간(프리셋)을 받아 발급을 트리거한다.
// 발급 자체(평문 노출)는 별도 TokenIssueDialog 가 담당 — 이 모달은 닫힌 뒤 그쪽이 열린다.

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// GitHub PAT 등 통상적인 프리셋 — 30일을 기본값(권장)으로 안내.
const EXPIRY_PRESETS = {
  '30d': { label: '30일', days: 30 },
  '60d': { label: '60일', days: 60 },
  '90d': { label: '90일', days: 90 },
  '365d': { label: '1년', days: 365 },
  never: { label: '무기한', days: null },
} as const;

type ExpiryPreset = keyof typeof EXPIRY_PRESETS;

const issueSchema = z.object({
  name: z.string().trim().min(1, '토큰 이름을 입력하세요').max(80, '토큰 이름은 80자 이하여야 합니다'),
  expiryPreset: z.enum(['30d', '60d', '90d', '365d', 'never'] as [ExpiryPreset, ...ExpiryPreset[]]),
});

type IssueFormData = z.infer<typeof issueSchema>;

// 프리셋 → expiresAt(ISO) 계산. 무기한이면 null.
function presetToExpiresAt(preset: ExpiryPreset): string | null {
  const { days } = EXPIRY_PRESETS[preset];
  if (days == null) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

interface TokenIssueFormDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSubmit: (input: { name: string; expiresAt: string | null }) => Promise<void>;
  isPending: boolean;
}

export function TokenIssueFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: TokenIssueFormDialogProps) {
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<IssueFormData>({
    resolver: zodResolver(issueSchema),
    defaultValues: { name: '', expiryPreset: '30d' },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setServerError('');
    }
    onOpenChange(next);
  };

  const submit = async (data: IssueFormData) => {
    setServerError('');
    try {
      await onSubmit({ name: data.name, expiresAt: presetToExpiresAt(data.expiryPreset) });
      reset();
    } catch {
      setServerError('토큰 발급에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="token-issue-form-dialog">
        <DialogHeader>
          <DialogTitle>API 토큰 발급</DialogTitle>
          <DialogDescription>
            외부 도구(Claude Code 등)가 내 권한으로 접근할 때 쓰는 개인 토큰입니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="token-name">토큰 이름</Label>
            <Input
              id="token-name"
              placeholder="예: claude-code-mcp"
              maxLength={80}
              {...register('name')}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="token-expiry">유효기간</Label>
            <Controller
              name="expiryPreset"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="token-expiry" data-testid="token-expiry-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(EXPIRY_PRESETS) as [
                        ExpiryPreset,
                        (typeof EXPIRY_PRESETS)[ExpiryPreset],
                      ][]
                    ).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={isPending} data-testid="token-issue-submit">
              발급
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
