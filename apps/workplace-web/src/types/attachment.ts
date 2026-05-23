// 이슈 첨부 응답 — 백엔드 IssueAttachmentResponse 와 1:1 매칭.

export interface IssueAttachment {
  fileId: number;
  issueId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  attachedById: number;
  attachedByName: string;
  attachedAt: string;
}
