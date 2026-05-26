// workplace-api 응답 스키마 — MCP 도구가 LLM 에 전달할 형태로 좁힌 부분 집합.
// 본 스키마는 workplace-api 의 IssueDetailResponse 와 1:1 일치하지 않는다.
// 도구 호출 결과로 LLM 이 읽을 핵심 필드만 포함.
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

export const issueDetail = z.object({
  issueKey: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  assignees: z.array(userSummary),
  comments: z.array(issueComment).optional(),
});

export type UserSummary = z.infer<typeof userSummary>;
export type IssueDetail = z.infer<typeof issueDetail>;

// /users/me 응답 — 캐시할 self id 만 필요.
export const selfUser = z.object({
  id: z.number(),
  username: z.string(),
  kind: z.enum(['HUMAN', 'AGENT']),
});
export type SelfUser = z.infer<typeof selfUser>;
