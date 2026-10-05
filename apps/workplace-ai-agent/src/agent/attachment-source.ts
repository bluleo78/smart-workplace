// WP-244: 이슈 챗 AI 가 볼 첨부의 공통 목록 — 이슈 첨부 + 최근 스레드 메시지 첨부.
// 러너와 무관한 "무엇이 있고 추출 상태가 어떤지" 만 담는다. 러너별 표현은 attachment-presenter.ts 몫.
import type { ChatMessageItem, ExtractionInfo, WorkplaceApiClient } from '../clients/workplace-api.js';

export type AttachmentOrigin =
  | { kind: 'issue'; issueKey: string }
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
  /** 이슈 첨부 목록 조회가 실패했는지(대개 에이전트가 프로젝트 멤버가 아니어서 403). */
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

/**
 * 이슈 첨부와 recent(이미 받아 둔 최근 스레드 메시지)의 첨부를 하나로 모은다. 추가 API 호출은 이슈 첨부 목록 1회뿐.
 * 이슈 첨부 목록이 실패해도(권한 등) 챗 첨부만으로 진행한다 — 첨부 하나 때문에 답변 전체를 막지 않기 위해.
 * 대신 issueListFailed 로 실패를 알려, 모델이 "이슈에 첨부가 없다" 고 잘못 단정하지 않게 한다.
 */
export async function collectAttachments(
  client: WorkplaceApiClient,
  agentId: number,
  issueKey: string,
  threadId: number,
  recent: ChatMessageItem[],
): Promise<CollectedAttachments> {
  const out: AgentAttachment[] = [];
  const seen = new Set<number>();
  let issueListFailed = false;

  try {
    for (const a of await client.listIssueAttachments(agentId, issueKey)) {
      seen.add(a.fileId);
      out.push({
        origin: { kind: 'issue', issueKey },
        fileId: a.fileId,
        originalName: a.originalName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        extraction: a.extraction ?? NO_EXTRACTION,
      });
    }
  } catch (e) {
    issueListFailed = true;
    console.warn('[attachment-source] 이슈 첨부 목록 조회 실패 — 챗 첨부만 사용', {
      issueKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 오래된→최신 순(프롬프트의 thread 흐름과 같은 순서). 삭제된 메시지의 첨부는 대화에서 빠진 것으로 본다.
  for (const m of [...recent].sort((x, y) => x.id - y.id)) {
    if (m.deleted) continue;
    for (const a of m.attachments ?? []) {
      if (seen.has(a.fileId)) continue;
      seen.add(a.fileId);
      out.push({
        origin: { kind: 'chat', threadId, messageId: m.id },
        fileId: a.fileId,
        originalName: a.originalName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        extraction: a.extraction ?? NO_EXTRACTION,
      });
    }
  }
  return { attachments: out, issueListFailed };
}
