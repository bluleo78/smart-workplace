// AI 계정 추가·수정 창(WP-1451) — 계정 탭의 「+ 계정 추가」와 줄 메뉴 「수정」이 연다.
// 추가: 종류(Claude 구독 / OpenAI 호환 / ChatGPT 로그인 / Gen:iA 로그인) + 라벨(비우면 서버가 「<종류> 계정」) + 종류별 입력.
// 수정: 라벨 바꾸기 + (선택) 키 교체. 종류는 바꾸지 못한다(표시만). 비밀값(토큰·API Key·로그인 정보)은 응답에 없으니 채워 두지 않고, 바꾼 칸만 보낸다.
// 종류별 입력부와 길이 규칙은 AI 별 연결 창(ProviderCredentialDialog)과 같은 것(credential-fields·lib/loginInfo)을 쓴다.
// OpenAI 호환 계정의 키 교체는 연결 설정(주소+키)을 통째로 바꾼다. 응답에 주소가 없어 채워 둘 수 없으니, 수정 창의 키 교체는 프리셋·주소를
// 빈 채로 시작해 다시 받는다 — 기본 프리셋(Bedrock)으로 채워 두면 키만 바꾸려다 회사 서버 주소가 조용히 Bedrock 으로 덮인다.
// OpenAI 호환 계정은 모델을 받지 않는다 — 계정 요청에 모델 칸이 없고 모델은 이 계정을 쓰는 AI 마다 고른다. 대신 「연결 확인」으로 주소·키가 맞는지 미리 본다.
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { probeAgentModels } from '@/api/models';
import { Badge } from '@/components/ui/badge';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCreateAgentAccount, useUpdateAgentAccount } from '@/hooks/queries/useAgentAccounts';
import { accountLabel, isLoginProvider } from '@/lib/agentAccount';
import { extractApiError, handleApiError } from '@/lib/api-error';
import { checkLoginInfo } from '@/lib/loginInfo';
import { type OpencodePresetKey, toOpencodeProviderConfig } from '@/lib/opencode-presets';
import type { AgentAccountResponse } from '@/types/agentAccount';
import type { CredentialProvider, ProviderConfig } from '@/types/providerCredential';

import { CLAUDE_TOKEN_MAX, CLAUDE_TOKEN_MIN, ClaudeTokenField } from './credential-fields/ClaudeTokenField';
import { LoginInfoField } from './credential-fields/LoginInfoField';
import {
  DEFAULT_OPENCODE_BASE_URL,
  DEFAULT_OPENCODE_PRESET,
  OpencodeConnectionFields,
} from './credential-fields/OpencodeConnectionFields';

/** 고르는 순서 — 키로 넣는 두 종류, 로그인 정보로 넣는 두 종류. */
const KINDS: readonly CredentialProvider[] = ['anthropic', 'opencode', 'chatgpt', 'genia'];

/** 라벨 최대 길이 — 서버 @Size(max = 80) 과 같다. */
const LABEL_MAX = 80;

/** 수정 창의 OpenAI 호환 키 교체 안내 — 주소는 응답에 없어 다시 받는다. */
const OPENCODE_REENTER_HINT = '주소는 보안상 다시 받지 않아요. 키를 바꾸려면 주소도 다시 넣어 주세요.';

/** 로그인 계정(ChatGPT·Gen:iA) 안내 — 같은 auth.json 을 두 곳에서 쓰면 갱신 토큰이 1회용이라 한쪽 로그인이 풀린다. */
const LOGIN_FILE_WARNING =
  '내 컴퓨터에서 쓰던 로그인 파일을 그대로 넣지 마세요. 이 계정용으로 새로 로그인한 파일을 넣어야 해요. 같은 로그인을 두 곳에서 쓰면 한쪽이 로그아웃돼요.';

interface Props {
  /** 고칠 계정 — null 이면 추가. */
  account: AgentAccountResponse | null;
  onClose: () => void;
}

/**
 * 계정 추가·수정 창. 열 때마다 새로 그려(부르는 쪽이 열 때만 마운트) 입력이 남지 않는다.
 * 추가는 종류에 맞는 원문 하나(token / providerConfig / loginInfo)와 라벨(적었을 때만)을, 수정은 바뀐 라벨과 「키 교체」를 열었을 때의 원문만 보낸다.
 */
export function AgentAccountDialog({ account, onClose }: Props) {
  const editing = account != null;
  const create = useCreateAgentAccount();
  const update = useUpdateAgentAccount();
  const pending = create.isPending || update.isPending;

  const [kind, setKind] = useState<CredentialProvider>(account?.provider ?? 'anthropic');
  // 라벨은 비밀값이 아니라 수정 때 지금 값을 채워 둔다.
  const [label, setLabel] = useState(account?.label ?? '');
  // 수정 창에서 「키 교체」를 열었는가 — 추가 창은 늘 원문을 받는다.
  const [replacing, setReplacing] = useState(!editing);

  // 종류별 원문 — 수정 창도 늘 빈 값에서 시작한다(기존 비밀값은 응답에 없고, 채우지도 않는다).
  const [token, setToken] = useState('');
  // OpenAI 호환 프리셋·주소 — 추가는 기본 프리셋(Bedrock)으로, 수정의 키 교체는 빈 채로(null) 시작해 다시 고르게 한다(지금 주소는 응답에 없다).
  const [presetKey, setPresetKey] = useState<OpencodePresetKey | null>(editing ? null : DEFAULT_OPENCODE_PRESET);
  const [baseUrl, setBaseUrl] = useState(editing ? '' : DEFAULT_OPENCODE_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [loginInfo, setLoginInfo] = useState('');
  const loginCheck = useMemo(
    () => (isLoginProvider(kind) ? checkLoginInfo(loginInfo, kind) : null),
    [kind, loginInfo],
  );

  // 프리셋을 아직 고르지 않았으면 보낼 설정이 없다 — secretReady 가 막으므로 보내지 않고, 연결 확인도 막힌다.
  const providerConfig = presetKey != null ? toOpencodeProviderConfig(presetKey, baseUrl, apiKey) : null;
  // 「연결 확인」 — 모델 목록을 받아 보면 주소·키가 맞는지 알 수 있다. 결과는 안내로만 쓰고 등록을 막지 않는다.
  const probe = useMutation({
    mutationFn: () => probeAgentModels({ providerConfig: providerConfig as ProviderConfig }),
  });

  // 서버 상한을 넘은 토큰 — 보내면 400 이니 칸 아래에 바로 알리고 저장을 막는다(최소 길이는 제출 때 토스트, AI 별 연결 창과 같다).
  // 로그인 정보의 상한은 미리 확인(checkLoginInfo)이 함께 본다 — 넘으면 확인 결과가 거절이라 아래 secretReady 가 막는다.
  const tokenTooLong = kind === 'anthropic' && token.trim().length > CLAUDE_TOKEN_MAX;

  /** 지금 칸의 원문이 보낼 만큼 채워졌는가 — 토큰 최소 길이 검사는 제출 때 토스트로 알린다(AI 별 연결 창과 같다). */
  const secretReady =
    kind === 'anthropic'
      ? token.trim().length > 0 && !tokenTooLong
      : kind === 'opencode'
        ? presetKey != null && baseUrl.trim().length > 0 && apiKey.length > 0
        : loginCheck?.ok === true;

  const trimmedLabel = label.trim();
  const labelChanged = editing && trimmedLabel !== account.label;
  // 수정 창에서 「키 교체」를 열어 두고 키가 덜 채워졌는가 — 라벨만 바꿔도 저장을 막는다(빈·덜 넣은 키가 함께 가거나, 넣던 키가 조용히 버려지지 않게).
  const replaceIncomplete = editing && replacing && !secretReady;
  // 수정은 바꾼 것이 있어야, 라벨을 비울 수는 없다(라벨만 고칠 때 빈 값은 서버가 바꾸지 않는다 — 헷갈리지 않게 막는다).
  const canSubmit = editing
    ? trimmedLabel.length > 0 && !replaceIncomplete && (labelChanged || replacing)
    : secretReady;

  /** 종류에 맞는 원문 한 칸 — 등록·키 교체 요청이 같이 쓴다. 검사는 submit 이 먼저 하고 여기는 모양만 바꾼다. */
  const secretPart = (): { token: string } | { providerConfig: ProviderConfig } | { loginInfo: string } => {
    if (kind === 'anthropic') return { token: token.trim() };
    if (kind === 'opencode') return { providerConfig: providerConfig as ProviderConfig };
    return { loginInfo };
  };

  const submit = async () => {
    // 원문을 보낼 때(추가·「키 교체」) 다 채워졌는지는 canSubmit(secretReady)이 이미 거른다.
    if (!canSubmit) return;
    // 토큰 최소 길이는 제출 때 알린다(AI 별 연결 창과 같다) — 칸에 치는 중에 「짧다」가 먼저 뜨지 않게.
    if (replacing && kind === 'anthropic' && token.trim().length < CLAUDE_TOKEN_MIN) {
      toast.error(`토큰이 너무 짧습니다 (최소 ${CLAUDE_TOKEN_MIN}자)`);
      return;
    }
    const secret = replacing ? secretPart() : undefined;
    try {
      if (editing) {
        await update.mutateAsync({
          id: account.id,
          body: { ...(labelChanged ? { label: trimmedLabel } : {}), ...(secret ?? {}) },
        });
        toast.success('계정을 수정했습니다.');
      } else {
        await create.mutateAsync({ provider: kind, ...(trimmedLabel ? { label: trimmedLabel } : {}), ...secret });
        toast.success('계정을 추가했습니다.');
      }
      onClose();
    } catch (e) {
      // 409 중복(같은 키의 계정이 이미 있음)·400 형식 오류는 서버 문구를 그대로 보인다.
      handleApiError(e, editing ? '계정을 수정하지 못했습니다' : '계정을 추가하지 못했습니다');
    }
  };

  /**
   * 연결 칸 하나를 바꾸고 앞선 「연결 확인」 결과를 지운다 — 프리셋·주소·키가 바뀌면 그 결과는 지금 값의 결과가 아니다.
   * 칸마다 같은 두 줄(값 바꾸기 + probe.reset)을 되풀이하지 않게 setter 를 감싼다.
   */
  const resettingProbe =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      probe.reset();
    };

  /** 입력한 원문(토큰·API Key·로그인 정보)과 연결 확인 결과를 비운다 — 종류 바꾸기와 「교체 안 함」이 같이 쓴다. */
  const clearSecrets = () => {
    setToken('');
    setApiKey('');
    setLoginInfo('');
    probe.reset();
  };

  // 종류를 바꾸면 앞 종류의 원문을 지운다 — 다른 종류의 값이 남아 보내지지 않게(보내는 칸은 종류로 고르지만 화면에도 남기지 않는다).
  const changeKind = (next: CredentialProvider) => {
    setKind(next);
    clearSecrets();
  };

  // 「교체 안 함」으로 접으면 넣던 원문을 비운다 — 접으면 입력부가 사라져 로그인 정보 칸의 요약(가림) 상태도 함께 사라지므로,
  // 원문이 남아 있으면 다시 열 때 auth.json 이 칸에 그대로 펼쳐진다. 다시 열면 늘 빈 칸에서 시작한다.
  // OpenAI 호환의 프리셋·주소도 비운다 — 다시 열면 주소를 다시 받는다(수정 창에서만 접을 수 있다).
  const toggleReplacing = () => {
    if (replacing) {
      clearSecrets();
      setPresetKey(null);
      setBaseUrl('');
    }
    setReplacing(!replacing);
  };

  const kindName = accountLabel(kind);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="agent-account-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? '계정 수정' : '계정 추가'}</DialogTitle>
          <DialogDescription>
            {editing
              ? '라벨을 바꾸거나 키를 새로 넣어요. 지금 키는 다시 보이지 않아요.'
              : 'AI 가 일할 때 쓸 계정을 넣어요. 저장한 키는 다시 보이지 않아요.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto">
          {editing ? (
            <div className="space-y-1.5">
              <Label>종류</Label>
              <div>
                <Badge variant="secondary" data-testid="agent-account-kind-fixed">
                  {kindName}
                </Badge>
              </div>
              {/* 로그인 계정(ChatGPT·Gen:iA)의 계정 이메일 — 표에서는 줄 높이를 맞추려고 빼고 여기서만 보인다(WP-1465). */}
              {account.accountEmail && (
                <p className="text-xs break-all text-muted-foreground" data-testid="agent-account-email">
                  {account.accountEmail}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>종류</Label>
              <RadioGroup
                value={kind}
                onValueChange={(v) => changeKind(v as CredentialProvider)}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                aria-label="계정 종류"
              >
                {KINDS.map((p) => (
                  <Label
                    key={p}
                    htmlFor={`agent-account-kind-${p}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-normal has-[[data-state=checked]]:border-primary"
                  >
                    <RadioGroupItem id={`agent-account-kind-${p}`} value={p} data-testid={`agent-account-kind-${p}`} />
                    {accountLabel(p)}
                  </Label>
                ))}
              </RadioGroup>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="agent-account-label">라벨</Label>
            <Input
              id="agent-account-label"
              data-testid="agent-account-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={LABEL_MAX}
              placeholder={editing ? undefined : `비우면 「${kindName} 계정」`}
              autoComplete="off"
            />
          </div>

          {editing && (
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <div>
                <p className="text-sm font-medium">키 교체</p>
                <p className="text-xs text-muted-foreground">새 키를 넣으면 이 계정을 쓰는 AI 가 다음 실행부터 새 키를 써요.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={replacing}
                onClick={toggleReplacing}
                data-testid="agent-account-replace-toggle"
              >
                {replacing ? '교체 안 함' : '키 교체'}
              </Button>
            </div>
          )}

          {replacing && (
            <div className="space-y-3" data-testid="agent-account-secret">
              {kind === 'anthropic' && (
                <>
                  <ClaudeTokenField value={token} onChange={setToken} />
                  {tokenTooLong && (
                    <p role="alert" className="text-xs text-destructive" data-testid="agent-account-token-too-long">
                      토큰이 너무 깁니다 (최대 {CLAUDE_TOKEN_MAX}자)
                    </p>
                  )}
                </>
              )}
              {kind === 'opencode' && (
                <>
                  {editing && (
                    <p className="text-xs text-muted-foreground" data-testid="agent-account-opencode-reenter-hint">
                      {OPENCODE_REENTER_HINT}
                    </p>
                  )}
                  <OpencodeConnectionFields
                    presetKey={presetKey}
                    onPresetChange={resettingProbe(setPresetKey)}
                    baseUrl={baseUrl}
                    onBaseUrlChange={resettingProbe(setBaseUrl)}
                    apiKey={apiKey}
                    onApiKeyChange={resettingProbe(setApiKey)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => probe.mutate()}
                      disabled={probe.isPending || presetKey == null || !baseUrl.trim() || !apiKey}
                      data-testid="agent-account-probe"
                    >
                      {probe.isPending ? '확인 중…' : '연결 확인'}
                    </Button>
                    {probe.isSuccess && (
                      <span className="text-xs text-success" data-testid="agent-account-probe-result">
                        연결됐어요 · 모델 {probe.data.models.length}개
                      </span>
                    )}
                    {probe.isError && (
                      <span role="alert" className="text-xs text-destructive" data-testid="agent-account-probe-result">
                        {extractApiError(probe.error, '연결하지 못했어요. 주소와 키를 확인하세요')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">모델은 이 계정을 쓰는 AI 마다 AI 상세에서 골라요.</p>
                </>
              )}
              {isLoginProvider(kind) && (
                <>
                  <p
                    className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning"
                    role="note"
                    data-testid="agent-account-login-warning"
                  >
                    {LOGIN_FILE_WARNING}
                  </p>
                  <LoginInfoField provider={kind} value={loginInfo} onChange={setLoginInfo} check={loginCheck} />
                </>
              )}
            </div>
          )}
        </div>
        {replaceIncomplete && (
          <p className="text-xs text-muted-foreground" data-testid="agent-account-replace-hint">
            키를 넣거나 「교체 안 함」을 눌러 주세요
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || pending} data-testid="agent-account-submit">
            {pending ? '저장 중…' : editing ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
