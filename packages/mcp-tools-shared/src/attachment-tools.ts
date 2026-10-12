// src/attachment-tools.ts — 이슈 첨부·드라이브 파일 내용 읽기 도구 read_attachment(WP-346). 두 앱 공유.
// 텍스트는 서버가 업로드 때 추출해 둔 텍스트를 구간으로 읽는다(원본을 받지 않는다). 이미지는 추출 대상이 아니라 서버가
// SKIPPED(reasonCode IMAGE)로 표시하므로, 그때만 원본을 받아 MCP image 블록으로 돌려준다(WP-345 McpToolResult).
// 이미지가 아닌 원본은 base64 로 돌려주지 않는다 — "텍스트로 읽기"와 "원본 받기"는 다른 도구다(원본 받기는 보류).
import { z } from 'zod';

import { baseMimeType, FileTooLargeError, IMAGE_MAX_BYTES, imageRejectReasons, READ_ATTACHMENT_DEFAULT_LIMIT, readRangeShape, resolveRange, toBase64 } from './attachment-read.js';
import type { McpToolResult } from './mcp-content.js';
import type { SharedTool } from './mcp-tool.js';
import type { AttachmentToolClient, ExtractedTextSlice, FileBytes } from './tool-client.js';

/**
 * 입력은 source 로 대상을 고르는 평평한 객체다. 판별 유니온(z.discriminatedUnion)을 쓰지 않는 이유: 두 앱 서버 레이어가
 * inputSchema.shape 를 registerTool 에 넘기므로 최상위가 z.object 여야 한다(workplace-mcp 테스트가 강제). source 별 필수 필드는
 * superRefine 이 확인하고, 핸들러가 parse 로 다시 검사한다(SDK 는 shape 만 검증한다).
 */
export const readAttachmentInput = z
  .object({
    source: z.enum(['issue', 'drive']),
    // 쓰지 않는 source 의 식별자를 모델이 null 로 채워 보내는 경우가 있어 nullish — null 은 "없음"으로 본다(범위 인자와 같은 이유).
    issueKey: z.string().min(1).nullish(),
    // WP-353: 이슈 첨부의 id. 서버는 core file id 로 가리키지만 도구 표면에서는 드라이브 driveFileId·채팅 첨부 fileId 와 섞이지 않게 attachmentId 로 부른다.
    attachmentId: z.number().int().positive().nullish(),
    driveFileId: z.number().int().positive().nullish(),
    ...readRangeShape,
  })
  .superRefine((v, ctx) => {
    if (v.source === 'issue') {
      if (v.issueKey == null || v.attachmentId == null) {
        ctx.addIssue({ code: 'custom', message: "source 'issue' 는 issueKey 와 attachmentId 가 필요합니다(get_issue_detail 의 attachments[].attachmentId)." });
      }
      if (v.driveFileId != null) {
        ctx.addIssue({ code: 'custom', message: "source 'issue' 에는 driveFileId 를 주지 마세요. 드라이브 파일은 source 'drive' 로 읽습니다." });
      }
    } else {
      if (v.driveFileId == null) {
        ctx.addIssue({ code: 'custom', message: "source 'drive' 는 driveFileId 가 필요합니다(list_drive_items·search_drive 결과의 driveFileId)." });
      }
      if (v.issueKey != null || v.attachmentId != null) {
        ctx.addIssue({ code: 'custom', message: "source 'drive' 에는 issueKey·attachmentId 를 주지 마세요. 이슈 첨부는 source 'issue' 로 읽습니다." });
      }
    }
  });

/** 서버가 이미지로 판정해 추출을 건너뛴 파일인지 — 이때만 원본을 받는다. */
const isImageSkip = (s: ExtractedTextSlice) => s.status === 'SKIPPED' && s.reasonCode === 'IMAGE';

/** 보낼 수 없는 이미지 안내 — 실제 사유만 말하고, 내용을 추측하지 않게 한다. label 은 JSON 으로 감싸 제어문자를 무력화한 이름·식별자. */
function imageNotice(label: string, reasons: string[]): string {
  return (
    `${label}: 이 이미지의 ${reasons.join('과 ')}는 모델에 보낼 수 없습니다(JPEG·PNG·GIF·WebP, ${IMAGE_MAX_BYTES}B 이하만 가능). ` +
    '이미지 내용을 추측하지 말고, 사용자에게 직접 확인해 달라고 안내하세요.'
  );
}

/**
 * 원본 받기 — 크기 메타가 없어 사전 검사를 못 한 경우를 위해 클라이언트가 다운로드 상한(IMAGE_MAX_BYTES)을 걸고,
 * 넘으면 FileTooLargeError 를 던진다. 그때도 사전 검사와 같은 "크기 초과" 안내로 잇는다.
 */
async function downloadImage(label: string, download: () => Promise<FileBytes>): Promise<McpToolResult> {
  try {
    return imageResult(label, await download());
  } catch (e) {
    if (e instanceof FileTooLargeError) return imageNotice(label, [`크기(${IMAGE_MAX_BYTES}B 초과)`]);
    throw e;
  }
}

/** 받은 원본 → [설명 text, image] 블록. 형식은 응답 Content-Type 에서 파라미터를 떼어 쓴다(모델 입력 형식). 받은 뒤에도 형식·크기를 다시 본다. */
function imageResult(label: string, bytes: FileBytes): McpToolResult {
  const mimeType = baseMimeType(bytes.mimeType);
  const reasons = imageRejectReasons(mimeType, bytes.data.byteLength);
  if (reasons.length > 0) return imageNotice(label, reasons);
  return [
    { type: 'text', text: `${label} (${mimeType}, ${bytes.data.byteLength}B)` },
    { type: 'image', data: toBase64(bytes.data), mimeType },
  ];
}

/** 첨부·파일 읽기 도구. kind read — 상태를 바꾸지 않는다(외부 MCP 노출). */
export function buildAttachmentTools(client: AttachmentToolClient): SharedTool[] {
  /** 이슈 첨부 이미지 — 목록에서 형식·크기를 먼저 보고, 보낼 수 있을 때만 원본을 받는다. */
  async function issueImage(issueKey: string, attachmentId: number): Promise<McpToolResult> {
    // 서버 첨부 행의 fileId 가 곧 attachmentId 다(이슈 첨부는 core file id 로 식별).
    const row = (await client.listIssueAttachments(issueKey)).find((a) => a.fileId === attachmentId);
    const label = `이슈 ${issueKey} 첨부 이미지 ${JSON.stringify(row?.originalName ?? `attachmentId ${attachmentId}`)}`;
    if (row) {
      const reasons = imageRejectReasons(row.mimeType, row.sizeBytes);
      if (reasons.length > 0) return imageNotice(label, reasons);
    }
    return downloadImage(label, () => client.downloadIssueAttachment(issueKey, attachmentId));
  }

  /** 드라이브 이미지 — 파일 메타 단건 API 가 없어 현재 버전 크기로 상한을 먼저 보고, 형식은 받은 응답의 Content-Type 으로 본다. */
  async function driveImage(driveFileId: number): Promise<McpToolResult> {
    const label = `드라이브 이미지(driveFileId ${driveFileId})`;
    const current = (await client.listDriveFileVersions(driveFileId)).find((v) => v.current);
    if (current && current.sizeBytes > IMAGE_MAX_BYTES) return imageNotice(label, [`크기(${current.sizeBytes}B)`]);
    return downloadImage(label, () => client.downloadDriveFile(driveFileId));
  }

  return [
    {
      name: 'read_attachment',
      app: ['issue', 'drive'],
      kind: 'read',
      description:
        '이슈 첨부나 드라이브 파일의 내용을 읽습니다. 이슈 첨부는 source:"issue" + issueKey + attachmentId(get_issue_detail 의 attachments[].attachmentId), ' +
        '드라이브 파일은 source:"drive" + driveFileId(list_drive_items·search_drive·search_drive_content 결과의 값)로 부릅니다. ' +
        `문서는 업로드 때 추출한 텍스트를 구간 단위로 JSON({status, offset, totalChars, truncated, nextOffset, text, reasonCode, reason})으로 돌려줍니다 — limit 생략 시 ${READ_ATTACHMENT_DEFAULT_LIMIT}자(최대 32000), ` +
        'nextOffset 이 있으면 offset 으로 넘겨 이어 읽고, truncated 가 true 면 추출 상한에서 잘린 것입니다. 위치는 글자(코드포인트) 단위입니다. ' +
        'status 가 READY 가 아니면 text 가 없습니다: PENDING 은 추출 중(잠시 후 다시), SKIPPED·FAILED 는 읽을 수 없는 파일(reason 을 그대로 알리기), NONE 은 추출 기록이 없는 파일입니다. 내용을 추측하지 마세요. ' +
        `이미지(JPEG·PNG·GIF·WebP, ${IMAGE_MAX_BYTES}B 이하)는 이미지 그대로 돌려주고, 그 밖의 이미지는 사유만 돌려줍니다. 원본 파일 자체는 돌려주지 않습니다.`,
      inputSchema: readAttachmentInput,
      async handler(args) {
        const p = readAttachmentInput.parse(args);
        const range = resolveRange(p);
        if (p.source === 'issue') {
          const issueKey = p.issueKey!;
          const attachmentId = p.attachmentId!;
          const slice = await client.readIssueAttachmentText(issueKey, attachmentId, range);
          if (isImageSkip(slice)) return issueImage(issueKey, attachmentId);
          // 서버 응답의 core fileId 는 입력과 같은 이름 attachmentId 로 돌려준다(입출력 이름 일치, WP-353).
          const { fileId: _coreFileId, ...rest } = slice;
          return JSON.stringify({ attachmentId, ...rest });
        }
        const driveFileId = p.driveFileId!;
        const slice = await client.readDriveFileText(driveFileId, range);
        if (isImageSkip(slice)) return driveImage(driveFileId);
        // #840: 드라이브 표면에는 core fileId 를 내보내지 않는다 — 다른 드라이브 도구와 같이 driveFileId 로만 가리킨다.
        const { fileId: _coreFileId, ...rest } = slice;
        return JSON.stringify({ driveFileId, ...rest });
      },
    },
  ];
}
