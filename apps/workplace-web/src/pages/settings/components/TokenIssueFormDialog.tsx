// API 토큰 발급 입력 모달 — 이름 + 유효기간(프리셋)을 받아 발급을 트리거한다.
// 발급 자체(평문 노출)는 별도 TokenIssueDialog 가 담당 — 이 모달은 닫힌 뒤 그쪽이 열린다.

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
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
import { Label } from '@/components/ui/label';
import { useClearOnFormChange } from '@/hooks/useClearOnFormChange';
import { extractApiError } from '@/lib/api-error';

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
    watch,
    formState: { errors },
  } = useForm<IssueFormData>({
    resolver: zodResolver(issueSchema),
    defaultValues: { name: '', expiryPreset: '30d' },
  });

  // 값이 바뀌면 지난 서버 사유를 지운다(WP-1776). 왜: 서버 사유는 「그때 보낸 값」에 대한 답인데, 이름을 비우는 등
  // 검증 실패 제출은 submit 이 불리지 않아 옛 서버 사유가 이름 안내와 함께 alert 로 읽혔다.
  useClearOnFormChange({ watch }, () => setServerError(''));

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
    } catch (e) {
      // 서버 사유(예: 활성 토큰 20개 상한, WP-818)를 창 안에 그대로 보인다 — 사유 없는 고정 문구만 보이고 사유는 토스트로만 나갔다(WP-835).
      setServerError(extractApiError(e, '토큰 발급에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* 도움말 문맥(WP-1506) — 열린 동안 도움말 패널이 매뉴얼 「토큰을 발급한다」 절(tokens.issue)을 보인다. */}
      <DialogContent data-testid="token-issue-form-dialog" data-help="tokens.issue">
        <DialogHeader>
          <DialogTitle>API 토큰 발급</DialogTitle>
          <DialogDescription>
            외부 도구(Claude Code 등)가 내 권한으로 접근할 때 쓰는 개인 토큰입니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
          {/* 공용 FormField 로 감싸 이름 오류를 화면 읽기가 읽게 한다 — 안내는 role=alert, 입력칸은 aria-invalid·aria-describedby 로 안내와 잇는다(WP-1776, 프로필 이름 칸과 같은 방식). */}
          <FormField
            label="토큰 이름"
            htmlFor="token-name"
            error={errors.name?.message}
            className="space-y-1.5"
          >
            {/* 요청 중에는 막는다 — 값을 바꾸면 늦게 온 서버 사유가 바뀐 값 아래에 붙는 경쟁이 생기므로 원천 차단 */}
            <Input
              id="token-name"
              disabled={isPending}
              placeholder="예: claude-code-mcp"
              maxLength={80}
              {...register('name')}
            />
          </FormField>

          <div className="space-y-1.5">
            <Label htmlFor="token-expiry">유효기간</Label>
            <Controller
              name="expiryPreset"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
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

          {serverError && (
            <p role="alert" className="text-sm text-destructive" data-testid="token-issue-error">
              {serverError}
            </p>
          )}

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
