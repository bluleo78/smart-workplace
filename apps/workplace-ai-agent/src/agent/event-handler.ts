// 4 type 별 acknowledgment 핸들러. LLM 없이 단순 한국어 텍스트로 응답한다.
// 5c-2 가 LLM 도입 시 본 파일을 갈아끼우거나 ack 분기를 옵션화한다.
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type {
  IssueAssignedPayload,
  IssueCommentedPayload,
  IssueCreatedPayload,
  IssueStatusChangedPayload,
} from '../types/issue-events.js';

// 5c-1 단계임을 명시하는 접미사 — 5c-2 LLM 도입 시 제거 예정.
const SUFFIX = ' _(자동 응답)_';
const COMMENT_BODY_TRUNCATE = 80;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function handleIssueCreated(
  client: WorkplaceApiClient,
  p: IssueCreatedPayload,
): Promise<void> {
  const body = `새 이슈 생성을 확인했습니다 — ${p.issueKey} "${p.issueTitle}"${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

export async function handleIssueAssigned(
  client: WorkplaceApiClient,
  p: IssueAssignedPayload,
): Promise<void> {
  const body = `작업을 맡았습니다 — ${p.issueKey}. 곧 진행하겠습니다.${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

export async function handleIssueCommented(
  client: WorkplaceApiClient,
  p: IssueCommentedPayload,
): Promise<void> {
  // defense-in-depth — 업스트림(5b-1) 이 actor.kind==AGENT 인 발사를 skip
  // 하지만, ai-agent 측에서도 명시적으로 차단해 self-loop 위험을 0 으로 한다.
  if (p.actor.kind === 'AGENT') return;
  const snippet = truncate(p.commentBody, COMMENT_BODY_TRUNCATE);
  const body = `코멘트 확인했습니다 (by @${p.actor.username}): "${snippet}"${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

export async function handleIssueStatusChanged(
  client: WorkplaceApiClient,
  p: IssueStatusChangedPayload,
): Promise<void> {
  const body = `상태 변경 확인 — ${p.previousStatus} → ${p.newStatus}${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

// workplace-api 호출 실패는 swallow — 이벤트 자체는 받았으니 발신자에게
// 202 를 유지한다. 재시도는 5b-1 의 발사 측이 책임.
async function safeCall(
  client: WorkplaceApiClient,
  issueKey: string,
  body: string,
): Promise<void> {
  try {
    await client.addIssueComment(issueKey, body);
  } catch (e) {
    console.error('[event-handler] addIssueComment 실패:', { issueKey, error: e });
  }
}
