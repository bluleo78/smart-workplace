// 비밀값을 언제 다시 받을지 — Secret 어노테이션(받은 기록)과 desired 의 version 을 비교한다.
// agent-key 를 받으면 곧 교체(generation+1 → Pod 재생성)라, runner 재시작만으로는 절대 다시 받지 않아야 한다.
import { ANN_AGENT_KEY_ID, ANN_AGENT_KEY_ROTATE_AFTER, ANN_CLAUDE_VERSION, ANN_LOGIN_VERSION, ANN_REPOS_VERSION } from './k8s/manifest.js';
import type { RunnerSecretRef } from './works/client.js';

/** 비밀값(claude·login·repos)을 어떻게 할지 — 받기 · 지우기(연결·등록 없음) · 그대로. */
export type SecretFetch = 'fetch' | 'clear' | 'keep';

/**
 * desired 의 비밀값 참조 `name` 의 version 문자열 — 참조가 없거나 version 이 null 이면 undefined(쓸 비밀값 없음).
 * 어노테이션(문자열)과 견주는 곳이 모두 이것을 써서 「없음」 처리가 한 가지로 맞는다(0 도 '0' 으로 값이다).
 */
export function refVersion(refs: RunnerSecretRef[], name: string): string | undefined {
  const v = refs.find((r) => r.name === name)?.version;
  return v == null ? undefined : String(v);
}

/**
 * 참조 `name` 의 version 을 Secret 어노테이션 값(받은 기록)과 견준다 — 참조가 없거나 version null 이면 clear,
 * 기록과 다르면(기록 없음 포함) fetch, 같으면 keep.
 */
function fetchOf(ref: RunnerSecretRef[], name: string, recorded: string | undefined): SecretFetch {
  const version = refVersion(ref, name);
  return version === undefined ? 'clear' : version !== recorded ? 'fetch' : 'keep';
}

/**
 * agentKey: 받은 기록이 없음 ∨ version null(Works 에 쓸 수 있는 키 없음) ∨ version 이 기록과 다름 ∨ 기록한 rotateAfter 가 지남.
 * Works 가 끄기·위치 이동으로 키를 5분 유예로 줄이면 그 키는 desired 에서 version=null 로 나온다(정리 유예 키는 「없음」) —
 * 「수명을 줄였는지」는 Works 한 곳에서 정하고 runner 는 desired 의 rotateAfter 를 따로 견주지 않는다.
 * 해석할 수 없는 기록 시각은 받을 근거로 쓰지 않는다(교체 폭주 방지).
 * repos(WP-1268): 참조가 없거나 version null 이면 clear(남은 repo-* 키를 지운다), 어노테이션 repos-version 과 다르면 fetch, 같으면 keep.
 * login(WP-1296): claude 와 같다 — 참조가 없거나 version null 이면 clear, 어노테이션 login-version 과 다르면 fetch, 같으면 keep.
 *   version 이 null 인 경우(활성 연결 없음·템플릿 계정과 다른 종류)는 서버가 정해 보내므로 runner 는 provider 를 따로 보지 않는다.
 * claude: 참조가 없거나 version null 이면 clear(남은 토큰을 지운다), version 이 기록과 다르면 fetch, 같으면 keep.
 */
export function secretFetches(
  ref: RunnerSecretRef[],
  annotations: Record<string, string>,
  now: Date,
): { agentKey: boolean; claude: SecretFetch; repos: SecretFetch; login: SecretFetch } {
  const agentKeyVersion = refVersion(ref, 'agent-key');

  const recordedKeyId = annotations[ANN_AGENT_KEY_ID];
  const rotateAfter = annotations[ANN_AGENT_KEY_ROTATE_AFTER];
  const rotateAfterMs = rotateAfter ? Date.parse(rotateAfter) : NaN;
  const agentKey =
    !recordedKeyId ||
    agentKeyVersion === undefined ||
    agentKeyVersion !== recordedKeyId ||
    (!Number.isNaN(rotateAfterMs) && rotateAfterMs < now.getTime());

  const claude = fetchOf(ref, 'claude', annotations[ANN_CLAUDE_VERSION]);
  const repos = fetchOf(ref, 'repos', annotations[ANN_REPOS_VERSION]);
  const login = fetchOf(ref, 'login', annotations[ANN_LOGIN_VERSION]);

  return { agentKey, claude, repos, login };
}
