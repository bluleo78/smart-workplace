// AI 계정 종류 규칙(WP-1296·1297) — 어떤 실행 방식이 어떤 AI 계정을 쓰는지, 화면에 무엇이라 부르는지 한곳에서 정한다.
// 템플릿이 쓰는 계정은 서버가 정해 template.account 로 준다 — 이 파일은 템플릿 이름·requires 값을 해석하지 않는다.
import type { AgentRunMode } from '@/types/agent';
import type { AgentTemplate } from '@/types/agentRuntime';
import type { CredentialProvider, LoginProvider } from '@/types/providerCredential';

/** 계정 종류마다 화면 이름과(로그인 정보면) 그 로그인을 쓰는 프로그램 — 이 표가 유일한 출처다(program 이 있으면 로그인 정보 계정). */
const ACCOUNTS: Record<CredentialProvider, { label: string; program?: string }> = {
  anthropic: { label: 'Claude 구독' },
  opencode: { label: 'OpenAI 호환' },
  genia: { label: 'Gen:iA 로그인', program: 'Gen:iA Code' },
  chatgpt: { label: 'ChatGPT 로그인', program: 'Codex' },
};

/** 로그인 정보로 연결하는 계정인지 — 연결 창이 토큰 칸 대신 로그인 정보 칸을 그린다. 표에서 program 이 있는 종류다. */
export function isLoginProvider(provider: CredentialProvider): provider is LoginProvider {
  return ACCOUNTS[provider].program !== undefined;
}

/** 기본 방식(서버가 바로 답한다)이 부를 수 있는 계정 — 로그인 정보가 아닌 것(Claude·OpenAI 호환 API). */
const SERVER_ACCOUNTS: readonly CredentialProvider[] = (Object.keys(ACCOUNTS) as CredentialProvider[]).filter((p) => !isLoginProvider(p));

/** 계정 종류의 화면 이름. */
export function accountLabel(provider: CredentialProvider): string {
  return ACCOUNTS[provider].label;
}

/** 로그인 정보를 쓰는 프로그램 이름(Gen:iA Code·Codex). */
export function loginProgram(provider: LoginProvider): string {
  return ACCOUNTS[provider].program!;
}

/**
 * 이 실행 방식이 이 계정으로 일할 수 있는지. 기본 = Claude·OpenAI 호환, 템플릿 = 그 템플릿의 계정 하나(요구가 없으면 기본과 같다),
 * 외부(내 컴퓨터)는 Works 의 AI 계정을 쓰지 않으니 무엇이든 그대로 둔다.
 */
export function accountFits(
  provider: CredentialProvider,
  card: { mode: AgentRunMode; template: Pick<AgentTemplate, 'account'> | null },
): boolean {
  if (card.mode === 'EXTERNAL') return true;
  // 기본 방식과 계정을 요구하지 않는 템플릿은 같은 규칙(서버 AgentAccountFit.fits 와 같다)
  const account = card.mode === 'WORKSPACE' ? card.template?.account : null;
  return account ? account === provider : SERVER_ACCOUNTS.includes(provider);
}

/** 새 계정이 반영되는 갈래 — 아래 문구 표가 이 값을 키로 쓴다(WP-1515·WP-2020). */
export type AccountChangeWhen = 'atIdle' | 'stopped' | 'now';

/**
 * 새 계정이 반영되는 갈래를 한 곳에서만 정한다(WP-1515·WP-2020) — 표면마다 따로 계산하면 어긋나는 이슈가 다시 생긴다.
 * 순서는 서버 계약에서 나온다: 쉴 때 적용(`accountChangeAppliesNow=false`)은 서버 RolloutPolicy 가 `desired != RUN` 일 때만
 * false 를 주므로 꺼짐(stopped)과 겹치지 않아 앞에 둔다.
 */
export function accountChangeWhen(appliesAtIdle: boolean, stopped: boolean): AccountChangeWhen {
  if (appliesAtIdle) return 'atIdle';
  if (stopped) return 'stopped';
  return 'now';
}

/**
 * 계정을 바꾸면 언제 새 계정으로 바뀌는지 고르기 창 안내(WP-1515·WP-2020).
 * 쉴 때 적용(서버 accountChangeAppliesNow=false)이면 서버가 generation 만 올려 두고 쉴 때 다시 띄운다 — 바로 바꾸려면 상태의 「지금 적용」.
 * 상태가 차단됨이거나 아직 보고 전일 수도 있어 「일하는 중」이라 단정하지 않고 「하던 작업이 있으면」으로 쓴다.
 * 쉬는 중이거나, 시작에 실패했는데 하던 일이 없으면 바로 다시 시작한다(WP-2000). 꺼져 있으면 다음에 시작할 때 적용된다(WP-2020).
 */
export const ACCOUNT_SWITCH_NOTICE: Record<AccountChangeWhen, string> = {
  atIdle: '하던 작업이 있으면 마치고 쉴 때 새 계정으로 바뀌어요. 바로 바꾸려면 바꾼 뒤 「지금 적용」을 누르세요',
  now: '바꾸면 이 AI 의 작업 공간이 새 계정으로 다시 시작돼요',
  stopped: '바꾸면 다음에 시작할 때 새 계정이 적용돼요',
};

/**
 * 계정을 바꾼 뒤 토스트의 덧말 — 안내(ACCOUNT_SWITCH_NOTICE)와 같은 갈래를 쓴다(WP-1515·WP-2020).
 * 쉴 때 적용이면 아직 옛 계정으로 일하니 바뀐 시점을 오해하지 않게, 꺼진 AI 는 지금 작업 공간이 뜨지 않는다는 점을 덧말이 암시한다.
 */
export const ACCOUNT_SWITCHED_TOAST_SUFFIX: Record<AccountChangeWhen, string> = {
  atIdle: ' 쉴 때 적용돼요.',
  now: '',
  stopped: ' 다음에 시작할 때 적용돼요.',
};

/** 「AI 계정」 묶음 옆 꼬리표 — 고르기 창·토스트와 같은 갈래의 말(WP-1515·WP-2020). */
export const ACCOUNT_HOW: Record<AccountChangeWhen, string> = {
  atIdle: '실행 중이면 쉴 때 적용',
  stopped: '다음에 시작할 때 반영',
  now: '바로 반영',
};
