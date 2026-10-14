// WP-234: 메인 AI 채팅 첨부 읽기 도구(read_chat_attachment) — assistant 프로필 전용.
// 세션은 인자로 받지 않고 실행 단위로 고정(homeSessionId)한다: 모델이 다른 세션 id 를 넣어 남의 대화 첨부를 읽는
// 경로 자체를 없애기 위해서다(서버도 소유자·세션 연결을 확인하지만 이중 방어). 매 호출 세션 목록을 먼저 받아
// MIME·크기·추출 상태를 확인한다 — stdio(opencode) 프로세스는 프롬프트의 첨부 목록을 볼 수 없기 때문이다.
// 문서는 추출 텍스트 구간(WP-242 계약, 공유 read_file 과 같은 표현), 이미지는 MCP image 블록(WP-240)으로 돌려준다.
// 범위·기본 길이·이미지 형식/크기 기준은 공유 read_file 과 같은 정의를 쓴다(WP-346, attachment-read.ts).
// 세션 첨부는 이슈·드라이브 파일이 아니라 세션에 묶인 파일이라 공유 도구로 읽을 수 없다 — 그래서 이 도구만 ai-agent 전용으로 남는다.
// opencode 비전 미지원 모델이면 stdio-entry 가 이미지 블록을 안내 문구로 바꾼다(WP-241).
// WP-250: 모델이 이미지를 볼 수 있으면(images.input) PDF 는 pages:[n] 으로 쪽 이미지를 보고(그림·도표·스캔 PDF), 이미지는
// 보낼 수 있으면 원본·아니면(HEIC·큰 이미지) 서버 변환본으로 돌려준다. 이미지 장수는 실행당 예산(images.budget)이 묶는다.
import {
  baseMimeType,
  type ImageBudget,
  imageBlocksFor,
  MAX_PAGES_PER_CALL,
  pageBlocks,
  pdfNote,
  pagesShape,
  READ_ATTACHMENT_DEFAULT_LIMIT,
  readRangeShape,
  resolveRange,
  type McpTool,
} from '@smart-workplace/mcp-tools-shared';
import { z } from 'zod';

import { fileKind } from '../agent/attachment-presenter.js';
import type { HomeAttachmentMeta, WorkplaceApiClient } from '../clients/workplace-api.js';

/** 세션에 묶이지 않은 실행(메인 채팅 외)에서 부르면 돌려줄 오류. */
export const NO_HOME_SESSION_ERROR =
  'read_chat_attachment 는 메인 AI 채팅 대화에서만 쓸 수 있습니다(이 실행에 묶인 대화가 없습니다).';

// offset/limit 범위(nullish·상한 32000)는 공유 read_file·이슈 챗 read_chat_thread_attachment 와 같은 계약이다.
const baseInput = z.object({
  fileId: z.number().int().positive(),
  ...readRangeShape,
});
// WP-250: pages(PDF 쪽 이미지)는 이미지를 볼 수 있는 모델에만 싣는다 — 못 쓰는 인자를 스키마에 두지 않는다.
const inputFor = (imageInput: boolean) => (imageInput ? baseInput.extend(pagesShape) : baseInput);

/** 모델이 이미지를 볼 수 있을 때 이미지 도구 설명에 덧붙이는 pages 한 문장(두 첨부 도구 공통). */
export const PAGES_DESCRIPTION = `PDF 는 pages:[n](최대 ${MAX_PAGES_PER_CALL}쪽)로 쪽 이미지를 볼 수 있습니다(그림·도표·스캔).`;

/** 추출이 READY 가 아닌 문서의 안내 — 상태·사유만 알리고 재업로드를 유도하지 않는다. 파일명은 JSON 으로 감싸 제어문자를 무력화. */
function nonReadyNotice(a: HomeAttachmentMeta, imageInput: boolean): string {
  const name = JSON.stringify(a.originalName);
  // 스캔 PDF 는 텍스트가 없는 게 아니라 "글자가 이미지"인 것 — pages 로 읽게 하거나(이미지 입력), 모델 전환을 안내한다.
  const scanned = pdfNote(a.extraction, imageInput);
  if (scanned) return `${name}: ${scanned}`;
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
  // WP-250: 모델이 이미지를 볼 수 있는지(기본 true)와 실행당 이미지 예산(없으면 호출당 3장만). buildTools 의 images 와 같은 값이다.
  images: { input: boolean; budget?: ImageBudget } = { input: true },
): McpTool {
  const input = inputFor(images.input);
  return {
    name: 'read_chat_attachment',
    description:
      '이 대화에 첨부된 파일을 읽습니다. 프롬프트 "## 이 대화의 첨부" 목록의 fileId 로 호출하세요. ' +
      `문서는 추출 텍스트를 구간 단위로 돌려줍니다(limit 생략 시 ${READ_ATTACHMENT_DEFAULT_LIMIT}자, 최대 32000 — 결과의 nextOffset 이 있으면 offset 으로 넘겨 이어 읽기). ` +
      '이미지는 이미지 그대로 돌려줍니다. 추출 중·읽을 수 없는 파일은 상태와 사유만 옵니다.' +
      (images.input ? ` ${PAGES_DESCRIPTION}` : ''),
    inputSchema: input,
    async handler(args) {
      const p = input.parse(args) as z.infer<typeof baseInput> & { pages?: number[] | null };
      if (!homeSessionId) throw new Error(NO_HOME_SESSION_ERROR);
      // 매 호출 목록을 다시 받는다 — 추출 상태가 실행 중에 READY 로 바뀔 수 있고, 목록에 없으면 이 세션 파일이 아니다.
      const list = await client.listHomeSessionAttachments(onBehalfOfId, homeSessionId);
      const a = list.find((x) => x.fileId === p.fileId);
      if (!a) {
        throw new Error(`이 대화의 첨부가 아닙니다(fileId ${p.fileId}). "이 대화의 첨부" 목록에 있는 fileId 를 쓰세요.`);
      }
      const name = JSON.stringify(a.originalName);
      if (p.pages) {
        // 쪽 이미지는 PDF 만 — 목록의 형식으로 먼저 거른다(이미지 파일은 pages 없이, 그 밖은 텍스트로 읽는다).
        if (baseMimeType(a.mimeType) !== 'application/pdf') {
          return `${name}: pages 는 PDF 에만 쓸 수 있습니다(${a.mimeType}). 이미지는 pages 없이, 문서는 텍스트로 읽으세요.`;
        }
        return pageBlocks(
          `첨부 PDF ${name}(fileId ${a.fileId})`,
          p.pages,
          (n) => client.viewHomeAttachment(onBehalfOfId, homeSessionId, a.fileId, n),
          images.budget,
        );
      }
      if (fileKind(a.mimeType) === 'image') {
        // 보낼 수 있는 형식·크기면 원본, 아니면(HEIC·TIFF·BMP·큰 이미지) 서버 변환본 — 다시 올려 달라고 하지 않는다.
        return imageBlocksFor(
          `첨부 이미지 ${name}(fileId ${a.fileId})`,
          a,
          () => client.downloadHomeAttachment(onBehalfOfId, homeSessionId, a.fileId),
          () => client.viewHomeAttachment(onBehalfOfId, homeSessionId, a.fileId),
          images.budget,
        );
      }
      if (a.extraction.status !== 'READY') return nonReadyNotice(a, images.input);
      const { offset, limit } = resolveRange(p);
      const slice = await client.readHomeAttachmentText(onBehalfOfId, homeSessionId, a.fileId, offset, limit);
      const note = pdfNote(slice, images.input);
      return JSON.stringify(note ? { ...slice, note } : slice);
    },
  };
}
