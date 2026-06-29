// 메일 계정 추가/수정 다이얼로그.
// - 추가 모드: 공급자 선택(IMAP/M365_GRAPH) → IMAP은 프리셋+폼, M365는 OAuth 버튼만.
// - 수정 모드: 기존 값 프리필. 비밀번호 빈 값이면 서버에서 기존 유지. 저장 버튼 항상 활성화.

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';

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
import { M365_OAUTH_CHANNEL, M365_OAUTH_SOURCE, type M365OAuthResult } from '@/lib/m365-oauth';
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

  const queryClient = useQueryClient();
  // M365 OAuth 팝업 흐름 상태. idle→connecting→(success 는 닫힘으로 표현)/error/blocked/cancelled.
  // error=일반 연결 실패, blocked=팝업 차단(window.open null). 메시지 분기를 phase 로 명시(popupRef 비대칭 제거).
  const [oauthPhase, setOauthPhase] = useState<'idle' | 'connecting' | 'error' | 'blocked' | 'cancelled'>('idle');
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);

  // 팝업 결과 수신(postMessage + BroadcastChannel) + 사용자 취소(closed) 감지.
  // connecting 동안에만 활성. 결과 1회 처리 후 정리.
  useEffect(() => {
    if (oauthPhase !== 'connecting') return;

    let done = false;
    const finish = (result: M365OAuthResult) => {
      if (done) return; // idempotent — postMessage/BroadcastChannel 중복 수신 방어
      done = true;
      cleanup();
      if (result.ok) {
        setOauthPhase('idle');
        void queryClient.invalidateQueries({ queryKey: ['mail-accounts'] });
        onOpenChange(false);
        // 성공 토스트는 부모(MailSettingsPage) 패턴과 일관되게 여기서 표시
        void import('sonner').then(({ toast }) => toast.success('Outlook 메일 계정이 연결되었습니다.'));
      } else {
        setOauthPhase('error');
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return; // 출처 검증(보안)
      const data = e.data as M365OAuthResult | undefined;
      if (data?.source === M365_OAUTH_SOURCE) finish(data);
    };
    const channel = (() => {
      try {
        return new BroadcastChannel(M365_OAUTH_CHANNEL);
      } catch {
        return null;
      }
    })();
    if (channel) {
      channel.onmessage = (e: MessageEvent) => {
        const data = e.data as M365OAuthResult | undefined;
        if (data?.source === M365_OAUTH_SOURCE) finish(data);
      };
    }
    window.addEventListener('message', onMessage);

    // 결과 없이 팝업이 닫히면 취소로 간주
    pollRef.current = window.setInterval(() => {
      if (popupRef.current?.closed && !done) {
        done = true;
        cleanup();
        setOauthPhase('cancelled');
      }
    }, 600);

    function cleanup() {
      window.removeEventListener('message', onMessage);
      channel?.close();
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return cleanup;
  }, [oauthPhase, onOpenChange, queryClient]);

  // "Outlook 계정 연결" 클릭: 동기 window.open(팝업 차단 회피) → /start → popup.location.
  const handleConnectOutlook = () => {
    // ⚠️ 동기 open 필수 — 비동기 fetch 이후 open 은 사용자 제스처가 풀려 팝업 차단됨.
    const popup = window.open('', 'm365-oauth', 'width=520,height=640');
    if (!popup) {
      setOauthPhase('blocked');
      popupRef.current = null;
      return; // 차단 → blocked 상태(아래 안내 문구 분기)
    }
    popupRef.current = popup;
    setOauthPhase('connecting');
    void getM365AuthorizeUrl()
      .then((url) => {
        popup.location.href = url;
      })
      .catch(() => {
        // 인가 URL 조회 실패(일반 연결 실패) — 팝업 닫고 ref 정리 후 error 상태
        popup.close();
        popupRef.current = null;
        setOauthPhase('error');
      });
  };

  // z.coerce 로 input·output 타입이 달라 RHF 3-제네릭(input, context, output) 사용
  const form = useForm<MailAccountFormInput, unknown, MailAccountFormData>({
    resolver: zodResolver(mailAccountSchema),
    defaultValues: EMPTY,
  });

  // 다이얼로그가 열릴 때마다 폼 초기화 + 공급자 초기화
  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    // OAuth 팝업 상태도 재오픈 시 idle 로 복귀 — stale 한 error/cancelled 잔존 방지
    setOauthPhase('idle');
    popupRef.current = null;
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

          {/* Outlook(M365 Graph) OAuth 연결 — 팝업 상태 머신(idle/connecting/error/cancelled) */}
          {isOAuth ? (
            <div className="space-y-4 py-2" role="status" aria-live="polite">
              {oauthPhase === 'connecting' ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">Microsoft 창에서 인증을 진행하세요…</p>
                  <p className="text-xs text-muted-foreground">창이 보이지 않으면 팝업 차단을 확인하세요.</p>
                </div>
              ) : (
                <>
                  {oauthPhase === 'blocked' && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.
                    </div>
                  )}
                  {oauthPhase === 'error' && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      Outlook 계정 연결에 실패했습니다. 다시 시도하세요.
                    </div>
                  )}
                  {oauthPhase === 'cancelled' && (
                    <p className="text-sm text-muted-foreground">연결이 취소되었습니다.</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    별도 창에서 Microsoft 로그인이 열립니다. 권한을 허용하면 자동으로 계정이 연결됩니다.
                  </p>
                  <Button type="button" className="w-full" onClick={handleConnectOutlook}>
                    {oauthPhase === 'error' || oauthPhase === 'blocked' || oauthPhase === 'cancelled'
                      ? '다시 시도'
                      : 'Outlook 계정 연결'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => onOpenChange(false)}
                  >
                    취소
                  </Button>
                </>
              )}
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

              {/* 개인 비서 opt-in — 켜면 개인 비서가 이 계정 메일을 개인 맞춤 처리(요약·회신·답장). */}
              <FormField label="개인 비서 사용" htmlFor="mail-ai-enabled">
                <div className="flex items-center gap-2">
                  <Switch
                    id="mail-ai-enabled"
                    data-testid="mail-ai-enabled"
                    checked={form.watch('aiEnabled')}
                    onCheckedChange={(v) => form.setValue('aiEnabled', v)}
                  />
                  <span className="text-xs text-muted-foreground">
                    켜면 개인 비서가 이 계정 메일을 개인 맞춤 요약하고, 회신 필요 여부·답장 초안을 돕습니다(본문이 개인 비서 AI로 전송됨, 기본 꺼짐).
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
