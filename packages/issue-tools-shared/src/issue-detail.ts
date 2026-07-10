// src/issue-detail.ts — get_issue_detail 응답을 LLM 노출용 flat superset 으로 정규화.
// 백엔드 IssueDetailResponse = { summary: IssueResponse, body, comments[], history[], attachments[], ... }.
// 의존성 필드(blockedBy/blocks/blocked)는 summary 중첩이므로 top-level 로 lift 한다(Phase 4b 가시성 보존).
import { z } from 'zod';

export const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullable().optional(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

export const issueComment = z.object({
  id: z.number(),
  body: z.string(),
  author: userSummary,
  createdAt: z.string(),
});

/** 의존성 링크 요약 — 백엔드 IssueLinkSummary(number,title,status,type) 중 LLM 필요분만. */
export const issueLink = z.object({
  number: z.number(),
  title: z.string(),
  status: z.string(),
});

export const issueDetail = z.object({
  issueKey: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  assignees: z.array(userSummary),
  comments: z.array(issueComment).default([]),
  blockedBy: z.array(issueLink).default([]),
  blocks: z.array(issueLink).default([]),
  blocked: z.boolean().default(false),
});

export type IssueDetail = z.infer<typeof issueDetail>;

/** summary 중첩을 풀고, comment 의 flat author 필드를 nested 로 변환하며, 의존성을 top-level 로 lift. */
export function normalizeIssueDetail(raw: unknown): IssueDetail {
  const r = (raw ?? {}) as Record<string, unknown>;
  const summary = (r.summary ?? {}) as Record<string, unknown>;
  const links = (arr: unknown): { number: number; title: string; status: string }[] =>
    ((arr ?? []) as Record<string, unknown>[]).map((l) => ({
      number: l.number as number,
      title: l.title as string,
      status: l.status as string,
    }));
  const normalized = {
    issueKey: r.issueKey ?? r.key ?? (summary.projectKey && `${summary.projectKey}-${summary.number}`),
    title: summary.title ?? r.title ?? '',
    body: r.body ?? summary.body ?? null,
    status: summary.status ?? r.status ?? '',
    priority: summary.priority ?? r.priority ?? '',
    assignees: summary.assignees ?? r.assignees ?? [],
    comments: ((r.comments ?? []) as Record<string, unknown>[]).map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: { id: c.authorId, username: c.authorName, name: c.authorName, kind: c.authorKind },
    })),
    blockedBy: links(summary.blockedBy),
    blocks: links(summary.blocks),
    blocked: summary.blocked ?? false,
  };
  return issueDetail.parse(normalized);
}
