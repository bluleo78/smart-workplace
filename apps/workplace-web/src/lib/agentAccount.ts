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
