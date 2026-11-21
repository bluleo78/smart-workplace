// 메일 계정 추가/수정 다이얼로그.
// - 추가 모드: 공급자 선택(IMAP/M365_GRAPH) → IMAP은 프리셋+폼, M365는 OAuth 버튼만.
// - 수정 모드: 기존 값 프리필. 비밀번호 빈 값이면 서버에서 기존 유지. 저장 버튼 항상 활성화.

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type SubmitHandler, useForm, useWatch } from 'react-hook-form';

import { getM365AuthorizeUrl } from '@/api/mailAccounts';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  useCreateMailAccount,
  useM365MailStatus,
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
import { MAIL_CONNECTION_FIELDS, mailConnectionFingerprint } from '@/lib/mailConnectionFingerprint';
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
  /** 새 계정 추가 시 적용할 전역 ai_enabled 값. 수정 모드에서는 기존 계정값을 그대로 사용. */
  defaultAiEnabled?: boolean;
}

// 연결 테스트 통과 = IMAP·SMTP 모두 성공 — 저장 허용과 결과 표시(통과 결과만 값 변경에 숨김)가 같은 기준을 쓴다(WP-1790).
const testPassed = (r: ConnectionTestResult) => r.imapOk && r.smtpOk;

// OAuth 오류 상자 — 팝업 차단·연결 실패를 같은 모양의 빨간 박스로 보인다(WP-1901: role=alert 로 읽힌다).
const OAUTH_ERROR_BOX_CLASS = 'rounded-md border border-destructive/50 bg-destructive/10 p-3';

/**
 * 연결 테스트 결과 한 줄(IMAP 또는 SMTP).
 * 실패는 빨간 오류, 통과는 초록 「연결됨」. 값을 바꾼 뒤 남은 결과(stale)의 성공 쪽은 테스트 안 한 값이라
 * 통과처럼 보이지 않게 흐린 「바꾸기 전 값으로 연결됨」으로 둔다(WP-1790 리뷰 후속).
 */
function TestResultRow({ testId, label, ok, error, stale }: {
  testId: string;
  label: string;
  ok: boolean;
  error: string | null;
  stale: boolean;
}) {
  const state = !ok ? 'fail' : stale ? 'stale' : 'ok';
  const color = { fail: 'text-destructive', stale: 'text-muted-foreground', ok: 'text-success' }[state];
  const text = { fail: error ?? '실패', stale: '바꾸기 전 값으로 연결됨', ok: '연결됨' }[state];
  return (
    <p data-testid={testId} className={`flex items-center gap-1 ${color}`}>
      {state === 'fail' && <X className="h-4 w-4" />}
      {state === 'ok' && <Check className="h-4 w-4" />}
      {label} {text}
    </p>
  );
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
  defaultAiEnabled = false,
}: MailAccountDialogProps) {
  const isEdit = !!account;
  const create = useCreateMailAccount();
  const update = useUpdateMailAccount();
  const testConn = useTestMailConnection();
  // 수정 모드는 비밀번호 미입력 시 저장된 비밀번호로 폴백하는 id 기반 테스트를 사용(#448)
  const testConnExisting = useTestMailConnectionForAccount();
  // 연결 테스트 결과 + 테스트한 연결 칸 지문 — 추가 모드에서 저장 가능 여부 판단에 사용.
  // 테스트한 값 지문과 지금 값이 같을 때만 결과를 쓴다 — 통과 뒤 연결 칸을 고쳐 테스트 안 한 값으로 저장되던 것(WP-1790)
  const [tested, setTested] = useState<{ result: ConnectionTestResult; fingerprint: string } | null>(null);
  // 연결 테스트 진행 잠금(WP-1770) — onTest 는 유효성 검사(form.trigger)를 await 한 뒤에야 mutation 을 시작하므로
  // 그 사이엔 isPending 이 false 라 두 번째 클릭이 통과했다. ref 는 같은 틱의 두 번째 클릭을 막고,
  // state 는 검사 중에도 버튼을 비활성·「테스트 중…」으로 보이게 한다(EventDialog submittingRef 와 같은 패턴).
  const testingRef = useRef(false);
  const [testing, setTesting] = useState(false);
  // 열림 세션 번호 — 다이얼로그를 닫았다 다시 열면 올린다. 이전 열림에서 아직 기다리던 onTest 가 늦게 끝나
  // 새 열림의 잠금을 풀거나 옛 결과(검사 안 한 입력의 통과)를 새 화면에 쓰지 못하게 onTest 가 시작 때의 번호와 비교한다.
  const testSessionRef = useRef(0);
  // 공급자 선택 — 추가 모드에서만 선택 가능(수정 모드는 기존 provider 고정). null = 아직 고르지 않음.
  const [chosenProvider, setChosenProvider] = useState<MailProvider | null>(null);
  // WP-879: Microsoft 로그인을 켠 워크스페이스는 추가 모드 기본 공급자를 Outlook 으로. 다이얼로그가 페이지에 늘 마운트돼 있어
  // 페이지 진입 때 미리 조회된다. 조회 전·실패면 IMAP.
  const { data: m365Status } = useM365MailStatus();
  const defaultProvider: MailProvider = m365Status?.preferred ? 'M365_GRAPH' : 'IMAP';
  // 상태로 동기화하지 않고 매번 계산한다 — 조회가 다이얼로그를 연 뒤 도착해도 폼 초기화 없이, 사용자가 고르지 않았을 때만 기본값이 바뀐다.
  const provider: MailProvider = account?.provider ?? chosenProvider ?? defaultProvider;
  // 사용자가 공급자 목록을 열거나 입력을 시작하면 지금 보이는 공급자로 고정한다 — 보이는 값을 다시 고르면 Select 가 변경 이벤트를
  // 내지 않아, 고정하지 않으면 늦게 온 기본값이 사용자가 쓰던 화면을 바꿔 버린다.
  const pinProvider = () => setChosenProvider((c) => c ?? provider);

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

  // 지금 연결 칸 값 — 바뀌면 지문이 달라져 옛 테스트 결과가 자동으로 무효가 된다(WP-1790).
  // 연결 칸만 구독해 표시 이름·AI 토글 입력으로는 다시 그리지 않는다.
  const watchedConnection = useWatch({ control: form.control, name: MAIL_CONNECTION_FIELDS });
  // 테스트한 값과 지금 값이 같은가 — 저장 허용(canSave)은 이 값이 참일 때의 결과만 쓴다.
  const testFresh = tested !== null && tested.fingerprint === mailConnectionFingerprint(watchedConnection);
  const freshResult = testFresh ? tested.result : null;
  // 화면에 보일 결과 — 통과 결과는 값을 바꾸면 숨기지만(테스트 안 한 값을 통과처럼 보이지 않게),
  // 실패 결과는 남긴다. 오류를 고치는 동안 무엇이 틀렸는지 볼 수 있어야 해서다(WP-1790 리뷰 후속).
  const shownResult = tested && (testFresh || !testPassed(tested.result)) ? tested.result : null;
  // 보이는 실패 결과가 지금 값으로 테스트한 것이 아니다 — 성공한 쪽도 「연결됨」(초록)으로 두지 않고 보조 문구를 붙인다.
  const shownStale = shownResult !== null && !testFresh;

  // 다이얼로그가 열릴 때마다 폼 초기화 + 공급자 초기화
  useEffect(() => {
    if (!open) return;
    setTested(null);
    // 열 때마다 새 세션 — 이전 열림의 진행 중 테스트가 남긴 잠금을 끊고, 그 테스트의 늦은 결과·해제는 무시된다
    testSessionRef.current += 1;
    testingRef.current = false;
    setTesting(false);
    // OAuth 팝업 상태도 재오픈 시 idle 로 복귀 — stale 한 error/cancelled 잔존 방지
    setOauthPhase('idle');
    popupRef.current = null;
    // 공급자 선택을 비운다 — 수정 모드는 기존 계정 공급자, 추가 모드는 워크스페이스 기본값(WP-879)으로 돌아간다.
    setChosenProvider(null);
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
      // 추가 모드 — 전역 ai_enabled 값 상속(부모 MailAccountsSection 에서 주입)
      form.reset({ ...EMPTY, aiEnabled: defaultAiEnabled });
    }
  }, [open, account, form, defaultAiEnabled]);

  /** 빠른 설정(provider) 선택 시 IMAP/SMTP 호스트·포트·보안 자동 채움 */
  const applyPreset = (name: string) => {
    const preset = MAIL_PROVIDER_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    form.setValue('imapHost', preset.imapHost);
    form.setValue('imapPort', preset.imapPort);
    form.setValue('imapSecurity', preset.imapSecurity);
    form.setValue('smtpHost', preset.smtpHost);
    form.setValue('smtpPort', preset.smtpPort);
    form.setValue('smtpSecurity', preset.smtpSecurity);
    // 테스트 결과는 여기서 지우지 않는다 — 바뀐 연결 칸은 지문 비교가 무효로 만든다(WP-1790)
  };

  /** 연결 테스트 — 먼저 전체 유효성 검사 후 API 호출 */
  const onTest = async () => {
    // 이미 검사·요청 중이면 무시 — 더블클릭으로 같은 요청이 두 번 나가는 것을 막는다(WP-1770)
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    // 이 호출이 속한 열림 세션 — await 뒤 다이얼로그가 다시 열렸다면(번호가 달라짐) 결과·잠금 해제를 건드리지 않는다
    const session = testSessionRef.current;
    try {
      const valid = await form.trigger();
      if (!valid) return;
      setTested(null);
      // getValues() 는 input 타입(coerce 전)이라 schema.parse 로 output 타입(number 포트) 변환
      const body = mailAccountSchema.parse(form.getValues());
      // 요청 직전 값의 지문 — 응답이 오기 전에 연결 칸을 고치면 지문이 달라져 늦은 통과가 저장을 열지 못한다(WP-1790)
      const fingerprint = mailConnectionFingerprint(form.getValues(MAIL_CONNECTION_FIELDS));
      // 수정 모드: 비밀번호 빈 값이면 서버가 저장된 비밀번호로 폴백(#448). 추가 모드: 본문 비밀번호 사용.
      const result =
        isEdit && account
          ? await testConnExisting.mutateAsync({ id: account.id, body })
          : await testConn.mutateAsync(body);
      if (session === testSessionRef.current) setTested({ result, fingerprint });
    } catch (e) {
      // 요청 실패(axios 오류)는 mutation onError 가 이미 토스트로 알렸으니 삼킨다. 그 밖의 오류(schema.parse 등 코드 결함)는 숨기지 않고 다시 던진다.
      if (!isAxiosError(e)) throw e;
    } finally {
      // 성공·검사 실패·오류 어느 쪽이든 잠금을 풀어 다시 누를 수 있게 한다 — 단 다시 열린 새 세션의 잠금은 건드리지 않는다
      if (session === testSessionRef.current) {
        testingRef.current = false;
        setTesting(false);
      }
    }
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
  // 인증 진행 여부 — 진행 안내 리전의 모양·내용과 「다시 시도」 단추 표시가 같은 기준을 쓴다.
  const connecting = oauthPhase === 'connecting';
  // 추가 모드는 IMAP + SMTP 모두 성공 후에만 저장 허용; 수정 모드는 항상 허용
  const canSave = isEdit || (freshResult !== null && testPassed(freshResult));
  // 저장이 막힌 이유 — 버튼만 회색이면 값을 다 채워도 왜 저장이 안 되는지 알 수 없었다(WP-928). 저장 버튼 아래에 보이고 버튼과 잇는다.
  const saveBlockedReason = (() => {
    if (canSave) return null;
    if (shownStale) return '값을 바꿨어요 — 바꾼 값으로 다시 연결 테스트를 해야 저장할 수 있어요.';
    if (shownResult) return '연결 테스트를 통과해야 저장할 수 있어요. 위 오류를 고친 뒤 다시 테스트하세요.';
    return '저장하려면 먼저 「연결 테스트」로 IMAP·SMTP 연결을 확인하세요.';
  })();

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

        {/* noValidate — 이메일 칸(type=email)의 브라우저 기본 검증이 제출을 먼저 막아 zod 의 한국어 안내 대신 말풍선만 뜨고 화면엔 문구가 남지 않았다(WP-912). 검증은 zod 스키마가 한다. */}
        <form noValidate onSubmit={form.handleSubmit(onSubmit)} onChange={pinProvider} className="space-y-3">
          {/* 선택칸 이름은 FormField 라벨(label[for])에서 온다 — aria-label 을 달면 보이는 라벨을 덮는다(WP-1772) */}
          {/* 추가 모드에서만 공급자 선택 드롭다운 표시 — 수정 모드는 기존 공급자 고정 */}
          {!isEdit && (
            <FormField label="공급자" htmlFor="mail-provider">
              <Select
                value={provider}
                onOpenChange={(o) => o && pinProvider()}
                onValueChange={(v) => setChosenProvider(v as MailProvider)}
              >
                <SelectTrigger id="mail-provider" className="w-full">
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
          {/* 오류 상자·진행 안내·단추를 원래 간격(space-y-4 py-2)으로 모은다.
              안의 polite 리전은 공급자 분기 밖에 두어 IMAP↔Outlook 을 바꿔도 다시 태어나지 않는다 —
              리전과 내용이 같은 렌더에 생기면 스크린리더가 안내를 건너뛰기 때문이다(WP-1901 리뷰 반려).
              내용이 없는 IMAP 에서는 이 래퍼가 흐름에서 빠진다(sr-only) — 빈 리전이 공급자 칸과 IMAP 칸 사이
              간격을 더 만들지 않고, 안의 리전은 계속 role=status 로 남아 전환 뒤에도 같은 노드다(WP-1934). */}
          <div className={isOAuth ? 'space-y-4 py-2' : 'sr-only'}>
            {/* 오류 두 개는 polite 리전 밖 — 같은 안내가 alert·status 두 경로로 두 번 읽히지 않게 (WP-1901) */}
            {isOAuth && oauthPhase === 'blocked' && (
              <FormError className={OAUTH_ERROR_BOX_CLASS}>
                팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.
              </FormError>
            )}
            {isOAuth && oauthPhase === 'error' && (
              <FormError className={OAUTH_ERROR_BOX_CLASS}>
                Outlook 계정 연결에 실패했습니다. 다시 시도하세요.
              </FormError>
            )}
            {/* 진행·취소 안내를 담는 polite 리전 — 인증 중에는 예전처럼 가운데 모아 그린다(flex gap-3 py-4) */}
            <div
              role="status"
              aria-live="polite"
              className={isOAuth && connecting ? 'flex flex-col items-center gap-3 py-4 text-center' : 'space-y-4'}
            >
              {isOAuth &&
                (connecting ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">Microsoft 창에서 인증을 진행하세요…</p>
                    <p className="text-xs text-muted-foreground">창이 보이지 않으면 팝업 차단을 확인하세요.</p>
                  </>
                ) : (
                  <>
                    {oauthPhase === 'cancelled' && (
                      <p className="text-sm text-muted-foreground">연결이 취소되었습니다.</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      별도 창에서 Microsoft 로그인이 열립니다. 권한을 허용하면 자동으로 계정이 연결됩니다.
                    </p>
                  </>
                ))}
            </div>
            {/* 인증 중에는 단추가 없어 빈 상자를 남기지 않는다 */}
            {isOAuth && !connecting && (
              <div className="space-y-4">
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
              </div>
            )}
          </div>
          {!isOAuth && (
            <>
              {/* ── IMAP 방식: 추가 모드 프리셋 + 전체 폼 ── */}
              {!isEdit && (
                <FormField label="빠른 설정(provider)" htmlFor="mail-preset">
                  <Select onValueChange={applyPreset}>
                    <SelectTrigger id="mail-preset" className="w-full">
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

              {/* 120자 초과 검증 실패를 그리지 않으면 연결 테스트·저장이 아무 반응 없이 멈춘다(WP-929). */}
              <FormField
                label="표시 이름(선택)"
                htmlFor="mail-display"
                error={form.formState.errors.displayName?.message}
              >
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
                    <SelectTrigger id="mail-imap-sec" className="w-full">
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
                    <SelectTrigger id="mail-smtp-sec" className="w-full">
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
              {shownResult && (
                <div data-testid="mail-test-result" role="status" className="rounded border p-2 text-sm">
                  <TestResultRow testId="mail-test-imap" label="IMAP" ok={shownResult.imapOk} error={shownResult.imapError} stale={shownStale} />
                  <TestResultRow testId="mail-test-smtp" label="SMTP" ok={shownResult.smtpOk} error={shownResult.smtpError} stale={shownStale} />
                  {shownStale && (
                    <p data-testid="mail-test-stale" className="mt-1 text-xs text-muted-foreground">
                      값을 바꿨어요 — 다시 테스트하세요.
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onTest()}
                  disabled={testing || saving}
                  data-testid="mail-test-button"
                >
                  {testing ? '테스트 중…' : '연결 테스트'}
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
                    aria-describedby={saveBlockedReason ? 'mail-save-blocked-reason' : undefined}
                    data-testid="mail-save-button"
                  >
                    {saving ? '저장 중…' : '저장'}
                  </Button>
                </div>
              </div>
              {saveBlockedReason && (
                <p
                  id="mail-save-blocked-reason"
                  className="text-right text-xs text-muted-foreground"
                  data-testid="mail-save-blocked-reason"
                >
                  {saveBlockedReason}
                </p>
              )}
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
