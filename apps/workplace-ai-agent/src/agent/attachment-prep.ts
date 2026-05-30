// 6c: 이슈 첨부를 per-run 임시폴더로 다운로드. 용량 가드 + manifest 반환.
// 모델은 이 manifest 의 localPath 를 Read 로 직접 읽는다(이미지/PDF/텍스트 네이티브).
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 파일당 10MB
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 합계 30MB

export interface AttachmentManifestEntry {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  skipped: boolean;
  skipReason?: string;
  localPath?: string;
}

// 안전한 파일명 — 경로 분리자/상위 이동 제거.
function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\-가-힣 ]+/g, '_');
}

export async function prepareAttachments(
  client: WorkplaceApiClient,
  agentId: number,
  issueKey: string,
  destDir: string,
): Promise<AttachmentManifestEntry[]> {
  const list = await client.listIssueAttachments(agentId, issueKey);
  const manifest: AttachmentManifestEntry[] = [];
  let total = 0;

  for (const a of list) {
    const base: AttachmentManifestEntry = {
      fileId: a.fileId,
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      skipped: false,
    };
    if (a.sizeBytes > MAX_FILE_BYTES) {
      manifest.push({ ...base, skipped: true, skipReason: '파일당 상한(10MB) 초과' });
      continue;
    }
    if (total + a.sizeBytes > MAX_TOTAL_BYTES) {
      manifest.push({ ...base, skipped: true, skipReason: '합계 상한(30MB) 초과' });
      continue;
    }
    try {
      const { data } = await client.downloadIssueAttachment(agentId, issueKey, a.fileId);
      const localPath = path.join(destDir, `${a.fileId}-${safeName(a.originalName)}`);
      writeFileSync(localPath, data);
      total += a.sizeBytes;
      manifest.push({ ...base, localPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      manifest.push({ ...base, skipped: true, skipReason: `다운로드 실패: ${msg}` });
    }
  }
  return manifest;
}
