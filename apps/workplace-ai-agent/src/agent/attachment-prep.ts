// 이슈 챗 첨부 원본을 per-run 임시폴더로 받는 헬퍼(WP-244 에서 presenter 하위로 축소).
// Claude 는 이미지·PDF·텍스트를, 비전 opencode 모델은 이미지만 받아 로컬로 본다. 그 외는 추출 텍스트 도구(presenter 참고).
// 실행 폴더(createAttachmentWorkDir)는 opencode read 를 가두는 에이전트별 루트 아래에 만든다(WP-236).
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { AgentAttachment } from './attachment-source.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 파일당 10MB
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 합계 30MB

// 에이전트별 첨부 작업폴더 루트(WP-236). 실행 폴더는 이 아래에 만들고, opencode 러너는 실행 폴더(없으면 이 루트)를
// 인스턴스 디렉터리로 써서 read 를 그 안으로 가둔다(WP-244 — 같은 에이전트의 다른 스레드 첨부도 보이지 않게).
// 에이전트별로 나누는 이유 — opencode read 는 디렉터리 목록도 보여주므로 루트를 공유하면 다른 에이전트(다른 테넌트)의
// 진행 중 실행 첨부가 보인다.
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

export type DownloadOutcome = { localPath: string } | { skipReason: string };

// 안전한 파일명 — 경로 분리자/상위 이동 제거.
function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\-가-힣 ]+/g, '_');
}

/** 주어진 첨부만 순서대로 받는다. 상한·실패는 skipReason 으로 돌려주고 나머지는 계속 받는다. */
export async function downloadAttachments(
  client: WorkplaceApiClient,
  agentId: number,
  attachments: AgentAttachment[],
  destDir: string,
): Promise<Map<number, DownloadOutcome>> {
  const result = new Map<number, DownloadOutcome>();
  let total = 0;
  for (const a of attachments) {
    if (a.sizeBytes > MAX_FILE_BYTES) {
      result.set(a.fileId, { skipReason: '파일당 상한(10MB) 초과' });
      continue;
    }
    if (total + a.sizeBytes > MAX_TOTAL_BYTES) {
      result.set(a.fileId, { skipReason: '합계 상한(30MB) 초과' });
      continue;
    }
    try {
      const { data } =
        a.origin.kind === 'issue'
          ? await client.downloadThreadIssueAttachment(agentId, a.origin.threadId, a.fileId)
          : await client.downloadChatAttachment(agentId, a.origin.threadId, a.origin.messageId, a.fileId);
      const localPath = path.join(destDir, `${a.fileId}-${safeName(a.originalName)}`);
      await writeFile(localPath, data);
      total += a.sizeBytes;
      result.set(a.fileId, { localPath });
    } catch (e) {
      result.set(a.fileId, { skipReason: `다운로드 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return result;
}
