// API 토큰 발급 입력 모달 — 이름 + 유효기간(프리셋)을 받아 발급을 트리거한다.
// 발급 자체(평문 노출)는 별도 TokenIssueDialog 가 담당 — 이 모달은 닫힌 뒤 그쪽이 열린다.

import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
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
import { FormError, FormField } from '@/components/ui/form-field';
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

// 서버 거절 사유 문단의 id — 이름 칸의 aria-describedby 가 가리킨다.
const SERVER_ERROR_ID = 'token-issue-error';

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
  // 제출 순번(WP-1776) — 제출마다 하나 올리고, 값 변경·창 닫기에서도 올려 도는 요청을 무효로 만든다.
  // 늦게 온 실패는 순번이 그대로일 때(보낸 뒤 값을 바꾸거나 창을 닫지 않았을 때)만 사유로 보인다 — 바뀐 값·새 창에 지난 답이 뜨지 않게.
  const submitSeq = useRef(0);

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
  // 요청 중 값을 바꾸면 그 요청의 늦은 실패도 「바뀌기 전 값」의 답이라 순번을 올려 버린다.
  useClearOnFormChange({ watch }, () => {
    submitSeq.current += 1;
    setServerError('');
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // 요청 중 닫았다 다시 열면 늦게 온 실패 사유가 새 창에 뜨지 않게 도는 요청을 무효로 만든다.
      submitSeq.current += 1;
      reset();
      setServerError('');
    }
    onOpenChange(next);
  };

  const submit = async (data: IssueFormData) => {
    submitSeq.current += 1;
    const seq = submitSeq.current;
    setServerError('');
    try {
      await onSubmit({ name: data.name, expiresAt: presetToExpiresAt(data.expiryPreset) });
      reset();
    } catch (e) {
      // 서버 사유(예: 활성 토큰 20개 상한, WP-818)를 창 안에 그대로 보인다 — 사유 없는 고정 문구만 보이고 사유는 토스트로만 나갔다(WP-835).
      if (seq === submitSeq.current) setServerError(extractApiError(e, '토큰 발급에 실패했습니다.'));
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
            // 서버 사유도 이름 칸과 잇는다(WP-1776 리뷰) — 칸으로 돌아온 화면 읽기 사용자가 거절 사유를 듣게.
            externalErrorId={serverError ? SERVER_ERROR_ID : undefined}
            className="space-y-1.5"
          >
            {/* 요청 중에도 칸을 열어 둔다 — Enter 로 보낸 뒤에도 초점이 이 칸에 남는다. */}
            <Input
              id="token-name"
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

          <FormError id={SERVER_ERROR_ID} data-testid="token-issue-error">{serverError}</FormError>

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
