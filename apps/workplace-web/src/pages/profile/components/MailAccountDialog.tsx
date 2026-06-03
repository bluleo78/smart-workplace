// 메일 계정 추가/수정 다이얼로그.
// - 추가 모드: 프리셋 드롭다운 → 호스트/포트/보안 자동 채움. 저장은 연결 테스트 성공 후에만 활성화.
// - 수정 모드: 기존 값 프리필. 비밀번호 빈 값이면 서버에서 기존 유지. 저장 버튼 항상 활성화.

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MAIL_PROVIDER_PRESETS,
  MAIL_SECURITY_OPTIONS,
} from '@/lib/constants/mailAccount';
import {
  mailAccountSchema,
  type MailAccountFormData,
  type MailAccountFormInput,
} from '@/lib/validations/mailAccount';
import {
  useCreateMailAccount,
  useTestMailConnection,
  useUpdateMailAccount,
} from '@/hooks/queries/useMailAccounts';
import type { ConnectionTestResult, MailAccountResponse } from '@/types/mailAccount';

interface MailAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: MailAccountResponse | null;
}

/** 빈 폼 초기값 */
const EMPTY: MailAccountFormData = {
  emailAddress: '',
  displayName: '',
  imapHost: '',
  imapPort: 993,
  imapSecurity: 'SSL_TLS',
  imapUsername: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecurity: 'STARTTLS',
  smtpUsername: '',
  password: '',
};

export function MailAccountDialog({
  open,
  onOpenChange,
  account,
}: MailAccountDialogProps) {
  const isEdit = !!account;
  const create = useCreateMailAccount();
  const update = useUpdateMailAccount();
  const testConn = useTestMailConnection();
  // 연결 테스트 결과 — 추가 모드에서 저장 가능 여부 판단에 사용
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  // z.coerce 로 input·output 타입이 달라 RHF 3-제네릭(input, context, output) 사용
  const form = useForm<MailAccountFormInput, unknown, MailAccountFormData>({
    resolver: zodResolver(mailAccountSchema),
    defaultValues: EMPTY,
  });

  // 다이얼로그가 열릴 때마다 폼 초기화
  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    if (account) {
      form.reset({
        emailAddress: account.emailAddress,
        displayName: account.displayName ?? '',
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapSecurity: account.imapSecurity,
        imapUsername: account.imapUsername,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecurity: account.smtpSecurity,
        smtpUsername: account.smtpUsername,
        password: '',
      });
    } else {
      form.reset(EMPTY);
    }
  }, [open, account, form]);

  /** provider 프리셋 선택 시 IMAP/SMTP 호스트·포트·보안 자동 채움 */
  const applyPreset = (name: string) => {
    const preset = MAIL_PROVIDER_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    form.setValue('imapHost', preset.imapHost);
    form.setValue('imapPort', preset.imapPort);
    form.setValue('imapSecurity', preset.imapSecurity);
    form.setValue('smtpHost', preset.smtpHost);
    form.setValue('smtpPort', preset.smtpPort);
    form.setValue('smtpSecurity', preset.smtpSecurity);
    // 폼 값 변경 후 테스트 결과 무효화
    setTestResult(null);
  };

  /** 연결 테스트 — 먼저 전체 유효성 검사 후 API 호출 */
  const onTest = async () => {
    const valid = await form.trigger();
    if (!valid) return;
    setTestResult(null);
    // getValues() 는 input 타입(coerce 전)이라 schema.parse 로 output 타입(number 포트) 변환
    const result = await testConn.mutateAsync(mailAccountSchema.parse(form.getValues()));
    setTestResult(result);
  };

  /** 저장 제출 — 성공 시 다이얼로그 닫기 */
  const onSubmit: SubmitHandler<MailAccountFormData> = async (data) => {
    try {
      if (isEdit && account) {
        await update.mutateAsync({ id: account.id, body: data });
      } else {
        await create.mutateAsync(data);
      }
      onOpenChange(false);
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  };

  const saving = create.isPending || update.isPending;
  // 추가 모드는 IMAP + SMTP 모두 성공 후에만 저장 허용; 수정 모드는 항상 허용
  const canSave =
    isEdit || (testResult?.imapOk === true && testResult?.smtpOk === true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="mail-account-dialog"
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? '메일 계정 수정' : '메일 계정 추가'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {/* 추가 모드에서만 provider 프리셋 드롭다운 표시 */}
          {!isEdit && (
            <FormField label="빠른 설정(provider)" htmlFor="mail-preset">
              <Select onValueChange={applyPreset}>
                <SelectTrigger id="mail-preset" aria-label="provider 프리셋" className="w-full">
                  <SelectValue placeholder="직접 입력" />
                </SelectTrigger>
                <SelectContent>
                  {MAIL_PROVIDER_PRESETS.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          <FormField
            label="이메일 주소"
            htmlFor="mail-email"
            error={form.formState.errors.emailAddress?.message}
          >
            <Input id="mail-email" type="email" {...form.register('emailAddress')} />
          </FormField>

          <FormField label="표시 이름(선택)" htmlFor="mail-display">
            <Input id="mail-display" {...form.register('displayName')} />
          </FormField>

          {/* ── 받기(IMAP) ── */}
          <p className="pt-1 text-sm font-medium text-muted-foreground">받기(IMAP)</p>
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="IMAP 호스트"
              htmlFor="mail-imap-host"
              error={form.formState.errors.imapHost?.message}
            >
              <Input id="mail-imap-host" {...form.register('imapHost')} />
            </FormField>
            <FormField
              label="포트"
              htmlFor="mail-imap-port"
              error={form.formState.errors.imapPort?.message}
            >
              <Input
                id="mail-imap-port"
                type="number"
                {...form.register('imapPort', { valueAsNumber: true })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="IMAP 보안" htmlFor="mail-imap-sec">
              <Select
                value={form.watch('imapSecurity')}
                onValueChange={(v) =>
                  form.setValue(
                    'imapSecurity',
                    v as MailAccountFormData['imapSecurity'],
                  )
                }
              >
                <SelectTrigger id="mail-imap-sec" aria-label="IMAP 보안" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIL_SECURITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label="IMAP 사용자명"
              htmlFor="mail-imap-user"
              error={form.formState.errors.imapUsername?.message}
            >
              <Input id="mail-imap-user" {...form.register('imapUsername')} />
            </FormField>
          </div>

          {/* ── 보내기(SMTP) ── */}
          <p className="pt-1 text-sm font-medium text-muted-foreground">보내기(SMTP)</p>
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="SMTP 호스트"
              htmlFor="mail-smtp-host"
              error={form.formState.errors.smtpHost?.message}
            >
              <Input id="mail-smtp-host" {...form.register('smtpHost')} />
            </FormField>
            <FormField
              label="포트"
              htmlFor="mail-smtp-port"
              error={form.formState.errors.smtpPort?.message}
            >
              <Input
                id="mail-smtp-port"
                type="number"
                {...form.register('smtpPort', { valueAsNumber: true })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="SMTP 보안" htmlFor="mail-smtp-sec">
              <Select
                value={form.watch('smtpSecurity')}
                onValueChange={(v) =>
                  form.setValue(
                    'smtpSecurity',
                    v as MailAccountFormData['smtpSecurity'],
                  )
                }
              >
                <SelectTrigger id="mail-smtp-sec" aria-label="SMTP 보안" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIL_SECURITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label="SMTP 사용자명"
              htmlFor="mail-smtp-user"
              error={form.formState.errors.smtpUsername?.message}
            >
              <Input id="mail-smtp-user" {...form.register('smtpUsername')} />
            </FormField>
          </div>

          <FormField
            label={isEdit ? '비밀번호(변경 시에만 입력)' : '비밀번호(앱 비밀번호)'}
            htmlFor="mail-pw"
            error={form.formState.errors.password?.message}
          >
            <Input
              id="mail-pw"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            Gmail·Outlook 등은 로그인 비밀번호 대신{' '}
            <strong>앱 비밀번호</strong>가 필요합니다.
          </p>

          {/* 연결 테스트 결과 인라인 표시 */}
          {testResult && (
            <div data-testid="mail-test-result" className="rounded border p-2 text-sm">
              <p className={testResult.imapOk ? 'text-green-600' : 'text-destructive'}>
                IMAP{' '}
                {testResult.imapOk ? '✓ 연결됨' : `✗ ${testResult.imapError ?? '실패'}`}
              </p>
              <p className={testResult.smtpOk ? 'text-green-600' : 'text-destructive'}>
                SMTP{' '}
                {testResult.smtpOk ? '✓ 연결됨' : `✗ ${testResult.smtpError ?? '실패'}`}
              </p>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void onTest()}
              disabled={testConn.isPending || saving}
              data-testid="mail-test-button"
            >
              {testConn.isPending ? '테스트 중…' : '연결 테스트'}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={saving || !canSave}
                data-testid="mail-save-button"
              >
                {saving ? '저장 중…' : '저장'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
