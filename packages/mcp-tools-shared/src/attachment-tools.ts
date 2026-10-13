// src/attachment-tools.ts — 이슈·노트·메시지·메일 첨부와 드라이브 파일 내용 읽기 도구 read_attachment(WP-346, WP-358). 두 앱 공유.
// 텍스트는 서버가 업로드 때 추출해 둔 텍스트를 구간으로 읽는다(원본을 받지 않는다). 이미지는 추출 대상이 아니라 서버가
// SKIPPED(reasonCode IMAGE)로 표시하므로, 그때만 원본을 받아 MCP image 블록으로 돌려준다(WP-345 McpToolResult).
// 이미지가 아닌 원본은 base64 로 돌려주지 않는다 — "텍스트로 읽기"와 "원본 받기"는 다른 도구다(원본 받기는 보류).
import { z } from 'zod';

import { baseMimeType, FileTooLargeError, IMAGE_MAX_BYTES, imageRejectReasons, READ_ATTACHMENT_DEFAULT_LIMIT, readRangeShape, resolveRange, toBase64 } from './attachment-read.js';
import type { McpToolResult } from './mcp-content.js';
import type { SharedTool } from './mcp-tool.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { AttachmentToolClient, ExtractedTextSlice, FileBytes } from './tool-client.js';

/** source 별 필수 식별자 — 나머지 식별자는 줄 수 없다. 필드 이름은 입력 이름 그대로다(드라이브만 driveFileId, 나머지 첨부는 attachmentId 를 재사용). */
const SOURCE_FIELDS = {
  issue: { required: ['issueKey', 'attachmentId'], from: 'get_issue_detail 의 attachments[].attachmentId' },
  drive: { required: ['driveFileId'], from: 'list_drive_items·search_drive 결과의 driveFileId' },
  wiki: { required: ['pageId', 'attachmentId'], from: '노트 본문 이미지 주소 .../attachments/{attachmentId}/content' },
  message: { required: ['channelId', 'messageId', 'attachmentId'], from: 'list_channel_messages·list_thread_replies 항목의 id 와 attachments[].fileId, 그 채널의 channelId' },
  mail: { required: ['attachmentId'], from: 'get_mail 의 attachments[].attachmentId' },
} as const;
const IDENTIFIER_FIELDS = ['issueKey', 'attachmentId', 'driveFileId', 'pageId', 'channelId', 'messageId'] as const;

/**
 * 입력은 source 로 대상을 고르는 평평한 객체다. 판별 유니온(z.discriminatedUnion)을 쓰지 않는 이유: 두 앱 서버 레이어가
 * inputSchema.shape 를 registerTool 에 넘기므로 최상위가 z.object 여야 한다(workplace-mcp 테스트가 강제). source 별 필수 필드는
 * superRefine 이 확인하고, 핸들러가 parse 로 다시 검사한다(SDK 는 shape 만 검증한다).
 * WP-358: source 가 5개(issue·drive·wiki·message·mail)로 늘었다. 정의 크기(도구 설명·입력 설명)를 아끼려고 첨부 id 는 attachmentId 하나를
 * 이슈·노트·메시지·메일이 같이 쓰고, 새 식별자는 pageId·channelId·messageId 뿐이다(이름은 다른 도구의 입력 이름과 같다).
 */
export const readAttachmentInput = z
  .object({
    source: z.enum(['issue', 'drive', 'wiki', 'message', 'mail']),
    // 쓰지 않는 source 의 식별자를 모델이 null 로 채워 보내는 경우가 있어 nullish — null 은 "없음"으로 본다(범위 인자와 같은 이유).
    issueKey: nullAsOmitted(z.string().min(1)),
    // WP-353: 이슈 첨부의 id. 서버는 core file id 로 가리키지만 도구 표면에서는 드라이브 driveFileId·채팅 첨부 fileId 와 섞이지 않게 attachmentId 로 부른다.
    // WP-358: 노트·메시지 첨부의 file id 와 메일 첨부 id 도 같은 이름이다(source 가 어느 것인지 정한다).
    attachmentId: nullAsOmitted(z.number().int().positive()),
    driveFileId: nullAsOmitted(z.number().int().positive()),
    pageId: nullAsOmitted(z.number().int().positive()),
    channelId: nullAsOmitted(z.number().int().positive()),
    messageId: nullAsOmitted(z.number().int().positive()),
    ...readRangeShape,
  })
  .superRefine((v, ctx) => {
    const { required, from } = SOURCE_FIELDS[v.source];
    const missing = required.filter((f) => v[f] == null);
    if (missing.length > 0) {
      ctx.addIssue({ code: 'custom', message: `source '${v.source}' 는 ${required.join('·')} 가 필요합니다(${from}).` });
    }
    const extra = IDENTIFIER_FIELDS.filter((f) => v[f] != null && !(required as readonly string[]).includes(f));
    if (extra.length > 0) {
      ctx.addIssue({ code: 'custom', message: `source '${v.source}' 에는 ${extra.join('·')} 를 주지 마세요. 다른 첨부는 그 source 로 읽습니다.` });
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
      app: ['issue', 'drive', 'wiki', 'mail', 'messaging'],
      kind: 'read',
      description:
        'Reads an attachment, by source: issue (이슈) {issueKey, attachmentId from get_issue_detail}; drive (드라이브) {driveFileId from ' +
        'list_drive_items, search_drive or search_drive_content}; wiki page (노트) image {pageId, attachmentId = id in a body image URL ' +
        '.../attachments/{id}/content}; chat message (메시지) {channelId, messageId, attachmentId = attachments[].fileId from list_channel_messages ' +
        'or list_thread_replies}; mail (메일) {attachmentId from get_mail}. Documents: a slice of the extracted text, {status, text, ' +
        `totalChars, nextOffset, truncated, reason} (limit default ${READ_ATTACHMENT_DEFAULT_LIMIT} code points); pass nextOffset as offset to ` +
        'continue; truncated:true = extraction was capped. Only READY has text: PENDING = extracting (retry soon; mail: first call), ' +
        `SKIPPED/FAILED = unreadable (relay reason), NONE = never extracted; never guess content. JPEG/PNG/GIF/WebP images up to ${IMAGE_MAX_BYTES} bytes ` +
        'return as images, others only a reason. Never the original file.',
      inputSchema: readAttachmentInput,
      async handler(args) {
        const p = readAttachmentInput.parse(args);
        const range = resolveRange(p);
        // superRefine 이 source 별 필수 식별자를 확인했으므로 단정(!)해도 된다.
        switch (p.source) {
          case 'issue': {
            const issueKey = p.issueKey!;
            const attachmentId = p.attachmentId!;
            const slice = await client.readIssueAttachmentText(issueKey, attachmentId, range);
            if (isImageSkip(slice)) return issueImage(issueKey, attachmentId);
            // 서버 응답의 core fileId 는 입력과 같은 이름 attachmentId 로 돌려준다(입출력 이름 일치, WP-353).
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ attachmentId, ...rest });
          }
          case 'drive': {
            const driveFileId = p.driveFileId!;
            const slice = await client.readDriveFileText(driveFileId, range);
            if (isImageSkip(slice)) return driveImage(driveFileId);
            // #840: 드라이브 표면에는 core fileId 를 내보내지 않는다 — 다른 드라이브 도구와 같이 driveFileId 로만 가리킨다.
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ driveFileId, ...rest });
          }
          case 'wiki': {
            const pageId = p.pageId!;
            const attachmentId = p.attachmentId!;
            const slice = await client.readWikiAttachmentText(pageId, attachmentId, range);
            // 노트 업로드는 지금 이미지만 받는다 — 그래서 새 첨부는 SKIPPED·IMAGE 이고 원본을 이미지 블록으로 돌려준다.
            // 배포 전에 올린 첨부는 추출 행이 없어 NONE 인데(노트는 백필하지 않는다) 이것도 이미지라서 같은 길로 받는다 — 이미지가 아니면
            // 받은 응답의 Content-Type 검사가 형식 사유로 막는다.
            // 노트·메시지·메일은 크기 메타를 알 길이 없어(목록 API 없음) 형식은 응답 Content-Type, 크기는 다운로드 상한(IMAGE_MAX_BYTES)으로 본다.
            if (isImageSkip(slice) || slice.status === 'NONE') {
              return downloadImage(`노트(pageId ${pageId}) 첨부 이미지(attachmentId ${attachmentId})`, () => client.downloadWikiAttachment(pageId, attachmentId));
            }
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ attachmentId, ...rest });
          }
          case 'message': {
            const channelId = p.channelId!;
            const messageId = p.messageId!;
            const attachmentId = p.attachmentId!;
            const slice = await client.readMessageAttachmentText(channelId, messageId, attachmentId, range);
            if (isImageSkip(slice)) {
              return downloadImage(`메시지(messageId ${messageId}) 첨부 이미지(attachmentId ${attachmentId})`, () =>
                client.downloadMessageAttachment(channelId, messageId, attachmentId),
              );
            }
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ attachmentId, ...rest });
          }
          case 'mail': {
            const attachmentId = p.attachmentId!;
            const slice = await client.readMailAttachmentText(attachmentId, range);
            if (isImageSkip(slice)) {
              return downloadImage(`메일 첨부 이미지(attachmentId ${attachmentId})`, () => client.downloadMailAttachment(attachmentId));
            }
            // 메일은 서버가 요청한 attachmentId 를 fileId 로 돌려준다(내부 사본 id 는 내보내지 않는다). 첫 호출은 서버가 사본을 만들며 추출을 시작해 PENDING 이다.
            const { fileId: _requestedId, ...rest } = slice;
            return JSON.stringify({
              attachmentId,
              ...rest,
              ...(slice.status === 'PENDING' && { note: '첨부를 가져와 텍스트를 추출하는 중입니다. 잠시(수 초~1분) 뒤 같은 인자로 다시 호출하세요.' }),
            });
          }
        }
      },
    },
  ];
}
