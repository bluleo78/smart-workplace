// WP-234: 메인 AI 채팅 첨부 읽기 도구(read_chat_attachment) — assistant 프로필 전용.
// 세션은 인자로 받지 않고 실행 단위로 고정(homeSessionId)한다: 모델이 다른 세션 id 를 넣어 남의 대화 첨부를 읽는
// 경로 자체를 없애기 위해서다(서버도 소유자·세션 연결을 확인하지만 이중 방어). 매 호출 세션 목록을 먼저 받아
// MIME·크기·추출 상태를 확인한다 — stdio(opencode) 프로세스는 프롬프트의 첨부 목록을 볼 수 없기 때문이다.
// 문서는 추출 텍스트 구간(WP-242 계약, read_attachment_text 와 같은 표현), 이미지는 MCP image 블록(WP-240)으로 돌려준다.
// opencode 비전 미지원 모델이면 stdio-entry 가 이미지 블록을 안내 문구로 바꾼다(WP-241).
import type { McpTool } from '@smart-workplace/mcp-tools-shared';
import { z } from 'zod';

import { fileKind } from '../agent/attachment-presenter.js';
import type { HomeAttachmentMeta, WorkplaceApiClient } from '../clients/workplace-api.js';
import { READ_ATTACHMENT_DEFAULT_LIMIT, readRangeShape } from './attachment-read-schema.js';

/** 모델에 이미지 블록으로 보낼 수 있는 형식 — Claude·opencode 비전 모델 공통 입력 형식. */
export const HOME_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** 이미지 원본 상한 3.75MB — base64(×4/3)로 늘면 모델 이미지 한도 5MB 에 닿는다. */
export const HOME_IMAGE_MAX_BYTES = 3_932_160;

/** 세션에 묶이지 않은 실행(메인 채팅 외)에서 부르면 돌려줄 오류. */
export const NO_HOME_SESSION_ERROR =
  'read_chat_attachment 는 메인 AI 채팅 대화에서만 쓸 수 있습니다(이 실행에 묶인 대화가 없습니다).';

/** 이미지 블록으로 보낼 수 있는지 — 형식과 원본 크기 모두 만족해야 한다. 프롬프트 상태 표기(home-attachments)와 공유. */
export function isSendableImage(a: Pick<HomeAttachmentMeta, 'mimeType' | 'sizeBytes'>): boolean {
  return HOME_IMAGE_MIMES.has(a.mimeType) && a.sizeBytes <= HOME_IMAGE_MAX_BYTES;
}

// offset/limit 범위(nullish·상한 32000)는 이슈 챗 read_attachment_text 와 같은 계약을 공유한다.
const readChatAttachmentInput = z.object({
  fileId: z.number().int().positive(),
  ...readRangeShape,
});

/** 추출이 READY 가 아닌 문서의 안내 — 상태·사유만 알리고 재업로드를 유도하지 않는다. 파일명은 JSON 으로 감싸 제어문자를 무력화. */
function nonReadyNotice(a: HomeAttachmentMeta): string {
  const name = JSON.stringify(a.originalName);
  switch (a.extraction.status) {
    case 'PENDING':
      return `${name}: 텍스트 추출 중입니다. 잠시 후 다시 읽어 보세요. 사용자에게 파일을 다시 올려 달라고 하지 마세요.`;
    case 'SKIPPED':
    case 'FAILED':
      return `${name}: 텍스트로 읽을 수 없습니다(${a.extraction.reason ?? '사유 미상'}). 이 사유를 사용자에게 알리고, 다시 올리거나 다른 형식으로 올려 달라고 하지 마세요.`;
    default:
      return `${name}: 텍스트 추출 대상이 아닌 형식입니다(${a.mimeType}). 파일 이름 등 알 수 있는 정보만 활용하세요.`;
  }
}

export function buildReadChatAttachmentTool(
  client: WorkplaceApiClient,
  onBehalfOfId: number,
  homeSessionId?: string,
): McpTool {
  return {
    name: 'read_chat_attachment',
    description:
      '이 대화에 첨부된 파일을 읽습니다. 프롬프트 "## 이 대화의 첨부" 목록의 fileId 로 호출하세요. ' +
      `문서는 추출 텍스트를 구간 단위로 돌려줍니다(limit 생략 시 ${READ_ATTACHMENT_DEFAULT_LIMIT}자, 최대 32000 — 결과의 nextOffset 이 있으면 offset 으로 넘겨 이어 읽기). ` +
      '이미지는 이미지 그대로 돌려줍니다. 추출 중·읽을 수 없는 파일은 상태와 사유만 옵니다.',
    inputSchema: readChatAttachmentInput,
    async handler(args) {
      const p = readChatAttachmentInput.parse(args);
      if (!homeSessionId) throw new Error(NO_HOME_SESSION_ERROR);
      // 매 호출 목록을 다시 받는다 — 추출 상태가 실행 중에 READY 로 바뀔 수 있고, 목록에 없으면 이 세션 파일이 아니다.
      const list = await client.listHomeSessionAttachments(onBehalfOfId, homeSessionId);
      const a = list.find((x) => x.fileId === p.fileId);
      if (!a) {
        throw new Error(`이 대화의 첨부가 아닙니다(fileId ${p.fileId}). "이 대화의 첨부" 목록에 있는 fileId 를 쓰세요.`);
      }
      if (fileKind(a.mimeType) === 'image') {
        if (!isSendableImage(a)) {
          // 실제 사유만 말한다 — 형식만 문제인데 크기까지 탓하면 모델이 엉뚱한 안내를 한다.
          const reasons: string[] = [];
          if (!HOME_IMAGE_MIMES.has(a.mimeType)) reasons.push(`형식(${a.mimeType})`);
          if (a.sizeBytes > HOME_IMAGE_MAX_BYTES) reasons.push(`크기(${a.sizeBytes}B)`);
          return `${JSON.stringify(a.originalName)}: 이 이미지의 ${reasons.join('과 ')}는 모델에 보낼 수 없습니다. 사용자에게 JPEG·PNG(3.75MB 이하)로 다시 올려 달라고 안내하세요.`;
        }
        const { data } = await client.downloadHomeAttachment(onBehalfOfId, homeSessionId, a.fileId);
        // mimeType 은 목록 값 — 응답 Content-Type 은 파라미터(charset 등)가 붙을 수 있어 모델 입력 형식으로 부적합.
        return [
          { type: 'text', text: `첨부 이미지 ${JSON.stringify(a.originalName)} (${a.mimeType}, ${a.sizeBytes}B, fileId ${a.fileId})` },
          { type: 'image', data: data.toString('base64'), mimeType: a.mimeType },
        ];
      }
      if (a.extraction.status !== 'READY') return nonReadyNotice(a);
      const offset = p.offset ?? undefined;
      const limit = p.limit ?? READ_ATTACHMENT_DEFAULT_LIMIT;
      return JSON.stringify(await client.readHomeAttachmentText(onBehalfOfId, homeSessionId, a.fileId, offset, limit));
    },
  };
}
