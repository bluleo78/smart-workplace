// src/agent-work-view.ts — 이슈의 AI 작업 진행(agentWork, WP-377) → LLM 뷰. 목록·상세·보고 응답이 같은 모양을 쓴다.
import { dropEmpty } from './compact.js';
import { toPersonView, toSeoulIso, type PersonView } from './issue-view.js';

type Raw = Record<string, unknown>;

/** LLM 에 내보내는 AI 작업 한 건. 빈 값은 키째 빠지고 stale·overdue 는 true 일 때만 있다. */
export interface AgentWorkOut {
  worker: PersonView;
  /** 시작 전(SUBMITTED) 행은 도구를 아직 몰라 키째 없다. */
  tool?: unknown;
  state: unknown;
  note?: unknown;
  progress?: unknown;
  stepsDone?: unknown;
  stepsTotal?: unknown;
  updatedAt: string | null;
  /** 다음 회차 대기(SCHEDULED)에서 정한 다음 실행 시각(KST) — 없으면 키째 없다(WP-450). */
  nextRunAt?: string;
  /** 2시간 넘게 보고가 없는 WORKING 만 — true 일 때만 싣는다. */
  stale?: true;
  /** 예정 시각(nextRunAt)이 2시간 넘게 지났는데 시작하지 않은 SCHEDULED — true 일 때만 싣는다(WP-450). */
  overdue?: true;
}

/**
 * 서버 AgentWorkView → LLM 뷰. 작업자는 숫자 id 를 빼고 {username,name,kind} 로만 가리키고(#833), 시각은 KST 로 바꾼다.
 * startedAt 은 뺀다 — 판단에 쓰는 것은 마지막 보고 시각(updatedAt)이다. tool·note·progress 등 null 은 생략해 토큰을 아낀다.
 */
export function toAgentWorkView(raw: unknown): AgentWorkOut {
  const w = (raw ?? {}) as Raw;
  return dropEmpty({
    worker: toPersonView((w.worker ?? {}) as Raw),
    tool: w.tool,
    state: w.state,
    note: w.note || undefined,
    progress: w.progress,
    stepsDone: w.stepsDone,
    stepsTotal: w.stepsTotal,
    updatedAt: toSeoulIso(w.updatedAt),
    nextRunAt: toSeoulIso(w.nextRunAt),
    ...(w.stale === true && { stale: true }),
    ...(w.overdue === true && { overdue: true }),
  }) as unknown as AgentWorkOut;
}
