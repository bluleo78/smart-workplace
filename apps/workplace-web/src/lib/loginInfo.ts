// 로그인 정보 미리 보기(WP-1296·1297) — 관리자가 붙여 넣은 Gen:iA·ChatGPT 로그인 정보(그 프로그램의 auth.json 내용)를 브라우저에서 먼저 살펴
// 「어떤 로그인인지 · 어느 계정인지 · 언제까지인지」를 보여 주고, 다른 프로그램의 파일이면 연결 전에 알린다.
// 최종 확인·다듬기(다른 공급자 자격 증명·API 키 제거)는 서버가 한다 — 여기서는 값을 보내기 전 사람이 알아볼 수 있게만 한다.
import { urlBase64ToBytes } from '@/lib/push/keys';
import type { LoginProvider } from '@/types/providerCredential';

/** 살펴본 결과 — ok 면 계정·만료 시각(알 수 있을 때), 아니면 화면에 보일 이유. */
export type LoginInfoCheck =
  | { ok: true; account: string | null; expiresAt: Date | null }
  | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JWT 가운데 부분(payload)을 읽는다 — 서명은 보지 않는다(표시용). UTF-8 로 풀어 한글 이메일도 깨지지 않게. 읽지 못하면 null. */
function jwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(urlBase64ToBytes(part)));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

/** Codex(ChatGPT 로그인) 파일 모양인지 — tokens 가 있다. 옛 codex 는 auth_mode 키 없이 OPENAI_API_KEY·tokens·last_refresh 만 쓴다. */
function looksLikeChatgpt(v: Record<string, unknown>): boolean {
  return isObject(v.tokens);
}

/** OPENAI_API_KEY 가 비었는지(없음·null·빈 문자열) — auth_mode 가 없는 파일은 이것으로 ChatGPT 로그인인지 가린다. */
const apiKeyEmpty = (v: Record<string, unknown>) => v.OPENAI_API_KEY == null || v.OPENAI_API_KEY === '';

/** Gen:iA 파일 모양인지 — 공급자 이름 genia 항목이 있다. */
function looksLikeGenia(v: Record<string, unknown>): boolean {
  return isObject(v.genia);
}

function checkChatgpt(v: Record<string, unknown>): LoginInfoCheck {
  const tokens = v.tokens as Record<string, unknown>;
  // auth_mode 가 있으면 chatgpt 여야 하고(apikey 등은 거절), 없으면 API 키가 비어 있어야 ChatGPT 로그인으로 본다 — 서버 LoginInfoNormalizer 와 같은 규칙.
  const chatgptMode = 'auth_mode' in v ? v.auth_mode === 'chatgpt' : apiKeyEmpty(v);
  if (!chatgptMode) return { ok: false, reason: 'ChatGPT 로 로그인한 정보가 아니에요 — codex login 에서 ChatGPT 로그인을 골라 주세요.' };
  if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
    return { ok: false, reason: '로그인을 이어 갈 정보(갱신 토큰)가 없어요 — codex login 을 다시 해 주세요.' };
  }
  const id = jwtPayload(tokens.id_token);
  const access = jwtPayload(tokens.access_token);
  const exp = typeof access?.exp === 'number' ? new Date(access.exp * 1000) : null;
  return { ok: true, account: typeof id?.email === 'string' ? id.email : null, expiresAt: exp };
}

function checkGenia(v: Record<string, unknown>): LoginInfoCheck {
  const g = v.genia as Record<string, unknown>;
  if (g.type !== 'oauth' || typeof g.refresh !== 'string' || g.refresh === '') {
    return { ok: false, reason: 'Gen:iA 로그인 정보가 아니에요 — genia 에서 /login genia 로 로그인해 주세요.' };
  }
  return {
    ok: true,
    account: typeof g.email === 'string' ? g.email : null,
    expiresAt: typeof g.expires === 'number' ? new Date(g.expires) : null,
  };
}

/** 붙여 넣은 로그인 정보를 살펴본다 — 비었으면 null(아직 넣지 않음). */
export function checkLoginInfo(text: string, provider: LoginProvider): LoginInfoCheck | null {
  if (text.trim() === '') return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: '로그인 정보를 읽지 못했어요 — 파일 내용을 빠짐없이 붙여 넣어 주세요.' };
  }
  if (!isObject(v)) return { ok: false, reason: '로그인 정보를 읽지 못했어요 — 파일 내용을 빠짐없이 붙여 넣어 주세요.' };
  if (provider === 'chatgpt') {
    if (looksLikeChatgpt(v)) return checkChatgpt(v);
    if (looksLikeGenia(v)) return { ok: false, reason: 'Gen:iA 로그인 정보예요 — ChatGPT 로그인 정보를 넣어 주세요.' };
  } else {
    if (looksLikeGenia(v)) return checkGenia(v);
    if (looksLikeChatgpt(v)) return { ok: false, reason: 'ChatGPT 로그인 정보예요 — Gen:iA 로그인 정보를 넣어 주세요.' };
  }
  return { ok: false, reason: '다른 프로그램의 파일 같아요 — 안내한 경로의 파일인지 확인해 주세요.' };
}
