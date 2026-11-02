// 비밀값을 언제 다시 받을지 — Secret 어노테이션(받은 기록)과 desired 의 version 을 비교한다.
// agent-key 를 받으면 곧 교체(generation+1 → Pod 재생성)라, runner 재시작만으로는 절대 다시 받지 않아야 한다.
import { ANN_AGENT_KEY_ID, ANN_AGENT_KEY_ROTATE_AFTER, ANN_CLAUDE_VERSION, ANN_REPOS_VERSION } from './k8s/manifest.js';
import type { RunnerSecretRef } from './works/client.js';

/** 모델 연결 토큰을 어떻게 할지 — 받기 · 지우기(연결 없음) · 그대로. */
export type ClaudeFetch = 'fetch' | 'clear' | 'keep';
/** 저장소 토큰을 어떻게 할지 — 같은 세 갈래. */
export type ReposFetch = ClaudeFetch;

/**
 * agentKey: 받은 기록이 없음 ∨ version null(Works 에 쓸 수 있는 키 없음) ∨ version 이 기록과 다름 ∨ 기록한 rotateAfter 가 지남.
 * Works 가 끄기·위치 이동으로 키를 5분 유예로 줄이면 그 키는 desired 에서 version=null 로 나온다(정리 유예 키는 「없음」) —
 * 「수명을 줄였는지」는 Works 한 곳에서 정하고 runner 는 desired 의 rotateAfter 를 따로 견주지 않는다.
 * 해석할 수 없는 기록 시각은 받을 근거로 쓰지 않는다(교체 폭주 방지).
 * repos(WP-1268): 참조가 없거나 version null 이면 clear(남은 repo-* 키를 지운다), 어노테이션 repos-version 과 다르면 fetch, 같으면 keep.
 * claude: 참조가 없거나 version null 이면 clear(남은 토큰을 지운다), version 이 기록과 다르면 fetch, 같으면 keep.
 */
export function secretFetches(
  ref: RunnerSecretRef[],
  annotations: Record<string, string>,
  now: Date,
): { agentKey: boolean; claude: ClaudeFetch; repos: ReposFetch } {
  const agentKeyVersion = ref.find((r) => r.name === 'agent-key')?.version ?? null;
  const claudeVersion = ref.find((r) => r.name === 'claude')?.version ?? null;

  const reposVersion = ref.find((r) => r.name === 'repos')?.version ?? null;

  const recordedKeyId = annotations[ANN_AGENT_KEY_ID];
  const rotateAfter = annotations[ANN_AGENT_KEY_ROTATE_AFTER];
  const rotateAfterMs = rotateAfter ? Date.parse(rotateAfter) : NaN;
  const agentKey =
    !recordedKeyId ||
    agentKeyVersion === null ||
    String(agentKeyVersion) !== recordedKeyId ||
    (!Number.isNaN(rotateAfterMs) && rotateAfterMs < now.getTime());

  const claude: ClaudeFetch =
    claudeVersion === null ? 'clear' : String(claudeVersion) !== annotations[ANN_CLAUDE_VERSION] ? 'fetch' : 'keep';

  const repos: ReposFetch =
    reposVersion === null ? 'clear' : String(reposVersion) !== annotations[ANN_REPOS_VERSION] ? 'fetch' : 'keep';

  return { agentKey, claude, repos };
}
