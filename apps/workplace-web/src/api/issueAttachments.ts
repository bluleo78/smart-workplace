// 이슈 첨부 API 클라이언트.
// 백엔드는 멤버 권한 다운로드 전용 엔드포인트(/attachments/{fileId}/content)를 제공한다.

import { client } from './client';
import type { IssueAttachment } from '../types/attachment';

// 클라이언트 사전 검증용 한도 — 백엔드 limit 와 일치해야 한다.
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_ISSUE = 10;

// 이슈에 부착된 첨부 목록 조회.
export async function listAttachments(
  projectKey: string,
  number: number,
): Promise<IssueAttachment[]> {
  const { data } = await client.get<IssueAttachment[]>(
    `/projects/${projectKey}/issues/${number}/attachments`,
  );
  return data;
}

// 다중 파일 업로드 — multipart/form-data, 필드명 `files` (백엔드 컨트랙트).
export async function uploadAttachments(
  projectKey: string,
  number: number,
  files: File[],
): Promise<IssueAttachment[]> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  const { data } = await client.post<IssueAttachment[]>(
    `/projects/${projectKey}/issues/${number}/attachments`,
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

// 첨부 삭제 — 첨부자 또는 프로젝트 OWNER 만 백엔드가 허용.
export async function deleteAttachment(
  projectKey: string,
  number: number,
  fileId: number,
): Promise<void> {
  await client.delete<void>(`/projects/${projectKey}/issues/${number}/attachments/${fileId}`);
}

// 다운로드 — blob 으로 받아 a[download] 트리거. 메모리 정리를 위해 URL.revokeObjectURL 호출.
export async function downloadAttachment(
  projectKey: string,
  number: number,
  fileId: number,
  fileName: string,
): Promise<void> {
  const { data } = await client.get<Blob>(
    `/projects/${projectKey}/issues/${number}/attachments/${fileId}/content`,
    { responseType: 'blob' },
  );
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
