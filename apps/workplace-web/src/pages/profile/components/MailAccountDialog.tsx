// 메일 계정 추가/수정 다이얼로그.
// - 추가 모드: 공급자 선택(IMAP/M365_GRAPH) → IMAP은 프리셋+폼, M365는 OAuth 버튼만.
// - 수정 모드: 기존 값 프리필. 비밀번호 빈 값이면 서버에서 기존 유지. 저장 버튼 항상 활성화.

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type SubmitHandler,useForm } from 'react-hook-form';

import { getM365AuthorizeUrl } from '@/api/mailAccounts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from '@/components/ui/switch';
import {
  useCreateMailAccount,
  useTestMailConnection,
  useTestMailConnectionForAccount,
  useUpdateMailAccount,
} from '@/hooks/queries/useMailAccounts';
import {
  MAIL_PROVIDER_OPTIONS,
  MAIL_PROVIDER_PRESETS,
  MAIL_SECURITY_OPTIONS,
} from '@/lib/constants/mailAccount';
import {
  type MailAccountFormData,
  type MailAccountFormInput,
  mailAccountSchema,
} from '@/lib/validations/mailAccount';
import type { ConnectionTestResult, MailAccountResponse, MailProvider } from '@/types/mailAccount';

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
  aiEnabled: false,
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
  // 수정 모드는 비밀번호 미입력 시 저장된 비밀번호로 폴백하는 id 기반 테스트를 사용(#448)
  const testConnExisting = useTestMailConnectionForAccount();
  // 연결 테스트 결과 — 추가 모드에서 저장 가능 여부 판단에 사용
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  // 공급자 선택 — 추가 모드에서만 선택 가능(수정 모드는 기존 provider 고정)
  const [provider, setProvider] = useState<MailProvider>('IMAP');

  // z.coerce 로 input·output 타입이 달라 RHF 3-제네릭(input, context, output) 사용
  const form = useForm<MailAccountFormInput, unknown, MailAccountFormData>({
    resolver: zodResolver(mailAccountSchema),
    defaultValues: EMPTY,
  });

  // 다이얼로그가 열릴 때마다 폼 초기화 + 공급자 초기화
  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    // 수정 모드는 기존 계정 공급자, 추가 모드는 IMAP 기본값
    setProvider(account?.provider ?? 'IMAP');
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
        aiEnabled: account.aiEnabled,
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
    const body = mailAccountSchema.parse(form.getValues());
    // 수정 모드: 비밀번호 빈 값이면 서버가 저장된 비밀번호로 폴백(#448). 추가 모드: 본문 비밀번호 사용.
    const result =
      isEdit && account
        ? await testConnExisting.mutateAsync({ id: account.id, body })
        : await testConn.mutateAsync(body);
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
  // OAuth 공급자는 저장 버튼 자체를 숨김(콜백이 계정 생성). IMAP은 연결 테스트 성공 후 허용.
  const isOAuth = provider === 'M365_GRAPH';
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
          <DialogDescription className="sr-only">{isEdit ? '메일 계정 수정' : '메일 계정 추가'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {/* 추가 모드에서만 공급자 선택 드롭다운 표시 — 수정 모드는 기존 공급자 고정 */}
          {!isEdit && (
            <FormField label="공급자" htmlFor="mail-provider">
              <Select value={provider} onValueChange={(v) => setProvider(v as MailProvider)}>
                <SelectTrigger id="mail-provider" aria-label="공급자" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIL_PROVIDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {/* Outlook(M365 Graph) OAuth 연결 안내 — IMAP 폼 전체 숨김 */}
          {isOAuth ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Microsoft 계정으로 이동해 권한을 허용하면 자동으로 계정이 연결됩니다.
                창이 닫히면 메일 설정 페이지로 돌아와 확인하세요.
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={async () => {
                  try {
                    // 인증된 axios로 인가 URL 조회 후 이동(C1 수정):
                    // top-level GET /start는 Bearer 헤더 미포함 → userId null → NPE 500.
                    // axios GET → 응답 URL로 window.location.href 이동으로 변경.
                    const url = await getM365AuthorizeUrl();
                    window.location.href = url;
                  } catch {
                    /* 토스트는 mutation onError 가 처리 — axios 인터셉터가 토스트 표시 */
                  }
                }}
              >
                Outlook 계정 연결
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
            </div>
          ) : (
            <>
              {/* ── IMAP 방식: 추가 모드 프리셋 + 전체 폼 ── */}
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

              {/* AI 비서 사용 토글 — 활성화 시 메일 본문이 AI 서비스로 전송됨 */}
              <FormField label="AI 비서 사용" htmlFor="mail-ai-enabled">
                <div className="flex items-center gap-2">
                  <Switch
                    id="mail-ai-enabled"
                    data-testid="mail-ai-enabled"
                    checked={form.watch('aiEnabled')}
                    onCheckedChange={(v) => form.setValue('aiEnabled', v)}
                  />
                  <span className="text-xs text-muted-foreground">
                    메일 요약·분류·답장 초안에 본문이 AI로 전송됩니다(기본 꺼짐).
                  </span>
                </div>
              </FormField>

              {/* 연결 테스트 결과 인라인 표시 */}
              {testResult && (
                <div data-testid="mail-test-result" className="rounded border p-2 text-sm">
                  <p
                    data-testid="mail-test-imap"
                    className={`flex items-center gap-1 ${testResult.imapOk ? 'text-success' : 'text-destructive'}`}
                  >
                    {testResult.imapOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    IMAP {testResult.imapOk ? '연결됨' : (testResult.imapError ?? '실패')}
                  </p>
                  <p
                    data-testid="mail-test-smtp"
                    className={`flex items-center gap-1 ${testResult.smtpOk ? 'text-success' : 'text-destructive'}`}
                  >
                    {testResult.smtpOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    SMTP {testResult.smtpOk ? '연결됨' : (testResult.smtpError ?? '실패')}
                  </p>
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onTest()}
                  disabled={testConn.isPending || testConnExisting.isPending || saving}
                  data-testid="mail-test-button"
                >
                  {testConn.isPending || testConnExisting.isPending
                    ? '테스트 중…'
                    : '연결 테스트'}
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
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
