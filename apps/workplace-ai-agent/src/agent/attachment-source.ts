// WP-244: 이슈 챗 AI 가 볼 첨부의 공통 목록 — 이슈 첨부 + 최근 스레드 메시지 첨부.
// 러너와 무관한 "무엇이 있고 추출 상태가 어떤지" 만 담는다. 러너별 표현은 attachment-presenter.ts 몫.
import type { ChatMessageItem, ExtractionInfo, WorkplaceApiClient } from '../clients/workplace-api.js';

// 이슈 첨부도 스레드 경유로 조회·다운로드·텍스트 읽기를 하므로 threadId 를 갖는다(WP-244 — 에이전트는 프로젝트 멤버가 아님).
export type AttachmentOrigin =
  | { kind: 'issue'; threadId: number }
  | { kind: 'chat'; threadId: number; messageId: number };

export interface AgentAttachment {
  origin: AttachmentOrigin;
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extraction: ExtractionInfo;
}

/** collectAttachments 결과 — 이슈 첨부 목록 실패 여부를 함께 넘겨 프롬프트가 "첨부 없음" 으로 단정하지 않게 한다. */
export interface CollectedAttachments {
  attachments: AgentAttachment[];
  /** 이슈 첨부 목록 조회가 실패했는지(스레드 열람 권한 없음·일시 오류 등). */
  issueListFailed: boolean;
}

/** 서버 응답에 extraction 이 없을 때(추출 대상 아님·구버전 응답) 쓰는 기본값. */
export const NO_EXTRACTION: ExtractionInfo = {
  status: 'NONE',
  totalChars: null,
  truncated: false,
  reasonCode: null,
  reason: null,
};

/** 서버 첨부 응답 항목 → AgentAttachment. 이슈·챗 매핑이 출처(origin)만 다르므로 한곳에서 만든다. */
function toAttachment(
  origin: AttachmentOrigin,
  meta: { fileId: number; originalName: string; mimeType: string; sizeBytes: number; extraction?: ExtractionInfo | null },
): AgentAttachment {
  return {
    origin,
    fileId: meta.fileId,
    originalName: meta.originalName,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    extraction: meta.extraction ?? NO_EXTRACTION,
  };
}

/**
 * 스레드가 딸린 이슈의 첨부 목록을 스레드 경유로 1회 조회한다(WP-244 — 이슈 첨부 API 는 프로젝트 멤버가 아닌 에이전트에 403).
 * 실패해도(권한 등) 던지지 않고 failed=true 로 알려, 챗 첨부만으로 진행하게 한다 — 첨부 하나 때문에 답변 전체를 막지 않기 위해.
 * 호출자는 failed 로 모델이 "이슈에 첨부가 없다" 고 단정하지 않게 한다.
 */
export async function fetchIssueAttachments(
  client: WorkplaceApiClient,
  agentId: number,
  threadId: number,
): Promise<{ attachments: AgentAttachment[]; failed: boolean }> {
  try {
    const list = await client.listThreadIssueAttachments(agentId, threadId);
    return { attachments: list.map((a) => toAttachment({ kind: 'issue', threadId }, a)), failed: false };
  } catch (e) {
    console.warn('[attachment-source] 이슈 첨부 목록 조회 실패 — 챗 첨부만 사용', {
      threadId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { attachments: [], failed: true };
  }
}

/**
 * recent(이미 받아 둔 최근 스레드 메시지)의 첨부(순수 함수). excludeFileIds(이슈 첨부 등)에 있는 fileId 는 건너뛰어
 * 이슈 쪽을 우선하고, 챗끼리도 fileId 중복은 먼저 나온 것만 쓴다. 삭제된 메시지의 첨부는 대화에서 빠진 것으로 본다.
 */
export function chatAttachments(
  threadId: number,
  recent: ChatMessageItem[],
  excludeFileIds: ReadonlySet<number> = new Set(),
): AgentAttachment[] {
  const seen = new Set(excludeFileIds);
  const out: AgentAttachment[] = [];
  // 오래된→최신 순(프롬프트의 thread 흐름과 같은 순서).
  for (const m of [...recent].sort((x, y) => x.id - y.id)) {
    if (m.deleted) continue;
    for (const a of m.attachments ?? []) {
      if (seen.has(a.fileId)) continue;
      seen.add(a.fileId);
      out.push(toAttachment({ kind: 'chat', threadId, messageId: m.id }, a));
    }
  }
  return out;
}

/** 이슈 첨부 + 챗 첨부를 합친다(이슈 우선). 이슈 목록 조회 1회 + 순수 합성. */
export function mergeAttachments(
  issue: { attachments: AgentAttachment[]; failed: boolean },
  threadId: number,
  recent: ChatMessageItem[],
): CollectedAttachments {
  const exclude = new Set(issue.attachments.map((a) => a.fileId));
  return {
    attachments: [...issue.attachments, ...chatAttachments(threadId, recent, exclude)],
    issueListFailed: issue.failed,
  };
}

/** 한 번에 모으는 편의 함수 — 이슈 목록 1회 조회 후 mergeAttachments. */
export async function collectAttachments(
  client: WorkplaceApiClient,
  agentId: number,
  threadId: number,
  recent: ChatMessageItem[],
): Promise<CollectedAttachments> {
  return mergeAttachments(await fetchIssueAttachments(client, agentId, threadId), threadId, recent);
}
