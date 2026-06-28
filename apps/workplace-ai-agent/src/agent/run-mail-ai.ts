// 7d: 메일 AI 러너 — 비서 OAuth 토큰 fetch → SDK 단발 실행 → 파서.
// 분류/요약/답장 모두 도구 미사용 텍스트 in/out. MCP 서버·임시 config 불필요.
import { runSdkCollect } from './sdk-runner.js';
import { extractResultText, parseClassifyJson, parseDraftCoachingJson, parseIssueDraftJson } from './mail-parser.js';
import {
  MAIL_CLASSIFY_PROMPT,
  MAIL_DRAFT_COACHING_PROMPT,
  MAIL_ISSUE_DRAFT_PROMPT,
  MAIL_REPLY_DRAFT_PROMPT,
  MAIL_SUMMARIZE_PROMPT,
} from './mail-system-prompt.js';
import type { RunAgentDeps } from './run-agent.js';

interface BaseConfig {
  assistantAgentId: number;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}
export interface ClassifyInput extends BaseConfig { subject: string; from: string; snippet: string; }
export interface SummarizeInput extends BaseConfig { subject: string; from: string; body: string; }
export interface ThreadMsg { from: string; date: string; body: string; }
export interface ReplyDraftInput extends BaseConfig { thread: ThreadMsg[]; replyingAs: string; }
export interface DraftCoachingInput extends BaseConfig {
  draftBody: string;
  thread: ThreadMsg[];
  replyingAs: string;
}

// 공통: 토큰 fetch → SDK 단발 실행 → 최종 텍스트. 도구 미사용이라 MCP 서버/임시 config 불필요.
// export: issue 등 다른 AI 러너도 동일 패턴으로 재사용.
export async function runText(
  systemPrompt: string,
  userMessage: string,
  cfg: BaseConfig,
  deps: RunAgentDeps,
  tag: string,
): Promise<string> {
  const token = (await deps.client.getOAuthToken(cfg.assistantAgentId)).token;
  const lines = await runSdkCollect({
    userMessage,
    systemPrompt,
    model: cfg.model,
    maxTurns: cfg.maxTurns,
    token,
    agentId: cfg.assistantAgentId,
    timeoutMs: cfg.timeoutMs,
    logTag: `${tag}:${cfg.assistantAgentId}`,
    includePartialMessages: false,
  });
  return extractResultText(lines);
}

// 메일 분류: 제목·보낸사람·미리보기 → {category, needsReply}
export async function runMailClassify(
  input: ClassifyInput,
  deps: RunAgentDeps,
): Promise<{ category: string; needsReply: boolean }> {
  const userMessage = `제목: ${input.subject}\n보낸사람: ${input.from}\n미리보기: ${input.snippet}`;
  return parseClassifyJson(await runText(MAIL_CLASSIFY_PROMPT, userMessage, input, deps, 'mail-classify'));
}

// 메일 요약: 제목·보낸사람·본문 → {summary}
export async function runMailSummarize(
  input: SummarizeInput,
  deps: RunAgentDeps,
): Promise<{ summary: string }> {
  const userMessage = `제목: ${input.subject}\n보낸사람: ${input.from}\n\n본문:\n${input.body}`;
  return { summary: (await runText(MAIL_SUMMARIZE_PROMPT, userMessage, input, deps, 'mail-summarize')).trim() };
}

// 답장 초안: 스레드 전체 + 발신자 → {draftBody}
export async function runMailReplyDraft(
  input: ReplyDraftInput,
  deps: RunAgentDeps,
): Promise<{ draftBody: string }> {
  const convo = input.thread.map((m) => `--- ${m.from} (${m.date})\n${m.body}`).join('\n\n');
  const userMessage = `당신은 ${input.replyingAs} 로서 아래 대화의 마지막 메일에 답장합니다.\n\n${convo}`;
  return { draftBody: (await runText(MAIL_REPLY_DRAFT_PROMPT, userMessage, input, deps, 'mail-reply-draft')).trim() };
}

export interface IssueDraftInput extends BaseConfig {
  subject: string;
  body: string;
  candidateProjects: { key: string; name: string }[];
}

// #520 메일→이슈 초안: 제목·본문·우선순위 + 후보 중 추천 projectKey.
export async function runMailIssueDraft(
  input: IssueDraftInput,
  deps: RunAgentDeps,
): Promise<{ title: string; body: string; priority: string; projectKey?: string }> {
  const projects = input.candidateProjects.map((p) => `- ${p.key}: ${p.name}`).join('\n') || '- (없음)';
  const userMessage = `제목: ${input.subject}\n\n본문:\n${input.body}\n\n후보 프로젝트:\n${projects}`;
  return parseIssueDraftJson(
    await runText(MAIL_ISSUE_DRAFT_PROMPT, userMessage, input, deps, 'mail-issue-draft'),
  );
}

// 초안 코칭: 내 초안(+답장이면 원문 스레드) → {notes, improvedBodyHtml}
export async function runMailDraftCoaching(
  input: DraftCoachingInput,
  deps: RunAgentDeps,
): Promise<{ notes: { dimension: string; message: string }[]; improvedBodyHtml: string }> {
  const convo = input.thread.map((m) => `--- ${m.from} (${m.date})\n${m.body}`).join('\n\n');
  const context = convo ? `원문 대화(답장 상황):\n${convo}\n\n` : '';
  const userMessage = `${context}당신은 ${input.replyingAs} 입니다. 아래 내 초안을 코칭하세요.\n\n내 초안:\n${input.draftBody}`;
  const text = await runText(MAIL_DRAFT_COACHING_PROMPT, userMessage, input, deps, 'mail-draft-coaching');
  return parseDraftCoachingJson(text);
}
