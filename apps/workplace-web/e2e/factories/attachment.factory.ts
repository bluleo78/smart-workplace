// 테스트용 이슈 첨부 응답 팩토리 — 백엔드 IssueAttachmentResponse 와 1:1.

import type { IssueAttachment } from '../../src/types/attachment';

export function createAttachment(
  overrides: Partial<IssueAttachment> = {},
): IssueAttachment {
  return {
    fileId: 9001,
    issueId: 1,
    originalName: 'spec.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    attachedById: 1,
    attachedByName: '테스트 사용자',
    attachedAt: new Date().toISOString(),
    ...overrides,
  };
}
