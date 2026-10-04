// 6c: 이슈 첨부를 per-run 임시폴더로 다운로드. 용량 가드 + manifest 반환.
// 모델은 이 manifest 의 localPath 를 Read 로 직접 읽는다(이미지/PDF/텍스트 네이티브).
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 파일당 10MB
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 합계 30MB

// 에이전트별 첨부 작업폴더 루트(WP-236). opencode 러너는 이 폴더를 인스턴스 디렉터리로 써서 read 를 이 안으로 가둔다.
// 에이전트별인 이유 — opencode read 는 디렉터리 목록도 보여주므로 루트를 공유하면 다른 에이전트(다른 테넌트)의
// 진행 중 실행 첨부가 보인다. 이슈 챗 도구는 이미 에이전트 신원(onBehalfOf=agentId)으로 동작하므로 경계를 맞춘 것.
// 실경로로 둔다 — opencode 는 실경로 기준으로 디렉터리 안/밖을 판정하므로 심링크 tmpdir(macOS /var→/private/var)
// 경로를 프롬프트에 넣으면 첨부가 '외부'로 판정돼 read 가 거부된다.
export function attachmentRootDir(agentId: number): string {
  const root = path.join(realpathSync(tmpdir()), 'workplace-chat-attachments', String(agentId));
  mkdirSync(root, { recursive: true });
  return root;
}

// per-run 첨부 작업폴더 생성 — 에이전트 루트 아래.
export function createAttachmentWorkDir(agentId: number, threadId: number): string {
  return mkdtempSync(path.join(attachmentRootDir(agentId), `chat-agent-${threadId}-`));
}

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
