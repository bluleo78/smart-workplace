// src/attachment-tools.ts — 이슈·노트·메시지·메일 첨부와 드라이브 파일 내용 읽기 도구 read_file(WP-346, WP-358, WP-369 에서 read_attachment 를 바꿈). 두 앱 공유.
// 텍스트는 서버가 업로드 때 추출해 둔 텍스트를 구간으로 읽는다(원본을 받지 않는다). 이미지는 추출 대상이 아니라 서버가
// SKIPPED(reasonCode IMAGE)로 표시하므로, 그때만 원본을 받아 MCP image 블록으로 돌려준다(WP-345 McpToolResult).
// 그대로 보낼 수 없는 이미지(HEIC·TIFF·BMP·3.75MB 초과)는 거절 안내 대신 서버가 변환한 이미지(/view)를 준다(WP-250, 메일 제외 — WP-388).
// PDF 는 원본이 아니라 서버가 그린 페이지 이미지만 돌려준다(WP-250) — pages:[n] 로 고른 쪽만, 호출당 3장까지.
import { z } from 'zod';

import { readRangeShape, resolveRange } from './attachment-read.js';
import { type ImageOptions, imageBlocksFor, MAX_PAGES_PER_CALL, pageBlocks, withPages } from './attachment-view.js';
import type { McpToolResult } from './mcp-content.js';
import type { SharedTool } from './mcp-tool.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { AttachmentToolClient, ExtractedTextSlice } from './tool-client.js';

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
 * read_file 입력 스키마를 만든다. 입력은 source 로 대상을 고르는 평평한 객체다. 판별 유니온(z.discriminatedUnion)을 쓰지 않는 이유: 두 앱 서버 레이어가
 * inputSchema.shape 를 registerTool 에 넘기므로 최상위가 z.object 여야 한다(workplace-mcp 테스트가 강제). source 별 필수 필드는
 * superRefine 이 확인하고, 핸들러가 parse 로 다시 검사한다(SDK 는 shape 만 검증한다).
 * WP-358: source 가 5개(issue·drive·wiki·message·mail)로 늘었다. 정의 크기(도구 설명·입력 설명)를 아끼려고 첨부 id 는 attachmentId 하나를
 * 이슈·노트·메시지·메일이 같이 쓰고, 새 식별자는 pageId·channelId·messageId 뿐이다(이름은 다른 도구의 입력 이름과 같다).
 * WP-250: imageInput 이면 pages(PDF 쪽 이미지)를 더한다 — 이미지를 볼 수 없는 모델에는 못 쓰는 인자를 보이지 않는다.
 * mail + pages 는 여기서 막지 않고 핸들러가 안내 문구로 돌려준다(던지면 모델이 오류로 보고 같은 호출을 되풀이한다).
 */
export function readFileInputFor(imageInput: boolean) {
  const base = z.object({
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
  });
  return withPages(base, imageInput).superRefine((v, ctx) => {
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
}

/** 기본(이미지 입력 가능) 스키마 — 테스트·외부에서 스키마 모양을 볼 때 쓴다. */
export const readFileInput = readFileInputFor(true);

/** read_file 옵션(WP-250) — 이미지 입력(images.input, 기본 true). */
export interface AttachmentToolOptions {
  images?: ImageOptions;
}

/** 메일 첨부 + pages — 메일은 /view 가 없다(WP-388). 던지지 않고 텍스트 읽기로 돌아가게 안내한다. */
const MAIL_PAGES_UNSUPPORTED = '메일 첨부는 아직 페이지 보기를 지원하지 않습니다. pages 없이 텍스트로 읽으세요.';

/** 서버가 이미지로 판정해 추출을 건너뛴 파일인지 — 이때만 원본을 받는다. */
export const isImageSkip = (s: Pick<ExtractedTextSlice, 'status' | 'reasonCode'>) => s.status === 'SKIPPED' && s.reasonCode === 'IMAGE';

/**
 * 드라이브 read_file 응답의 고쳐 쓰기 안내(WP-369 최종 리뷰 I4) — 외부 MCP 클라이언트가 일부만 읽고 create_drive_file(driveFileId, content)
 * 로 덮어 뒷부분을 잃지 않게 한다. 응답 글은 도구 정의 크기에 들지 않아(메일 PENDING note 와 같은 길) 설명 대신 여기서 알린다.
 * 추출이 잘렸으면(truncated) 끝까지 읽어도 전문이 아니므로 그 안내가 우선이다 — 서버도 그 파일의 내용 갱신을 409 로 막는다.
 */
function driveRewriteNote(slice: ExtractedTextSlice): string | undefined {
  if (slice.truncated) return 'Extraction is capped: do not rewrite via content; use the upload link (create_drive_file without content).';
  if (slice.nextOffset != null) {
    return `Partial text: continue with offset=${slice.nextOffset}; read to the end before rewriting with create_drive_file(driveFileId).`;
  }
  return undefined;
}

/**
 * PDF 응답 note(WP-250) — 텍스트로 못 읽는 쪽(그림·도표·스캔)을 pages 로 볼 수 있다고 알린다. 이미지를 볼 수 없는 모델(imageInput false)에는
 * READY 면 아무 말도 하지 않고, 스캔 PDF 면 연결 설정의 '이미지 입력' 지정이나 모델 변경으로 볼 수 있다고 알린다(사용자에게 다시 올려 달라고 하지 않게).
 * 쪽수(pageCount)는 이전 추출 행이면 null 이라 그때는 쪽수 없이 말한다.
 */
export function pdfNote(slice: Pick<ExtractedTextSlice, 'status' | 'reasonCode' | 'pageCount'>, imageInput: boolean): string | undefined {
  if (slice.status === 'SKIPPED' && slice.reasonCode === 'SCANNED_PDF') {
    // imageInput false 는 "못 본다"가 아니라 "볼 수 있다고 확인되지 않았다"일 수 있다(자동 감지 실패) — 단정하지 않고 수동 지정 길을 함께 알린다.
    if (!imageInput) {
      return (
        `글자가 없는 스캔 PDF${slice.pageCount ? `(${slice.pageCount}쪽)` : ''}라 글자로는 읽을 수 없고, 지금 설정으로는 페이지 이미지를 볼 수 없습니다. ` +
        "모델이 이미지를 볼 수 있다면 AI 연결 설정에서 '이미지 입력'을 '볼 수 있음'으로 지정하거나, 이미지를 볼 수 있는 모델로 바꾸면 페이지를 볼 수 있다고 사용자에게 안내하세요."
      );
    }
    return `글자가 없는 스캔 PDF${slice.pageCount ? `(${slice.pageCount}쪽)` : ' '}입니다. pages 로 페이지 이미지를 읽으세요.`;
  }
  if (imageInput && slice.status === 'READY' && slice.pageCount) return '그림·도표·스캔 페이지는 pages 로 이미지를 볼 수 있습니다.';
  return undefined;
}

/** 여러 안내를 한 note 로 — 없는 것은 빼고, 하나도 없으면 note 를 싣지 않는다. */
function noteField(...notes: (string | undefined)[]): { note?: string } {
  const text = notes.filter(Boolean).join(' ');
  return text ? { note: text } : {};
}

/** 파일·첨부 읽기 도구(read_file). kind read — 상태를 바꾸지 않는다(외부 MCP 노출). */
export function buildAttachmentTools(client: AttachmentToolClient, opts: AttachmentToolOptions = {}): SharedTool[] {
  const imageInput = opts.images?.input ?? true;
  const input = readFileInputFor(imageInput);

  /**
   * 이슈 첨부 이미지 — 목록에서 형식·크기를 먼저 보고, 보낼 수 있으면 원본, 아니면 변환본(/view)을 받는다.
   * 서버 첨부 행의 fileId 가 곧 attachmentId 다(이슈 첨부는 core file id 로 식별).
   */
  async function issueImage(issueKey: string, attachmentId: number): Promise<McpToolResult> {
    const row = (await client.listIssueAttachments(issueKey)).find((a) => a.fileId === attachmentId);
    const label = `이슈 ${issueKey} 첨부 이미지 ${JSON.stringify(row?.originalName ?? `attachmentId ${attachmentId}`)}`;
    return imageBlocksFor(
      label,
      row ? { mimeType: row.mimeType, sizeBytes: row.sizeBytes } : {},
      () => client.downloadIssueAttachment(issueKey, attachmentId),
      () => client.viewIssueAttachment(issueKey, attachmentId, undefined),
    );
  }

  /** 드라이브 이미지 — 파일 메타 단건 API 가 없어 현재 버전 크기로 상한을 먼저 보고, 형식은 받은 응답의 Content-Type 으로 본다. */
  async function driveImage(driveFileId: number): Promise<McpToolResult> {
    const current = (await client.listDriveFileVersions(driveFileId)).find((v) => v.current);
    return imageBlocksFor(
      `드라이브 이미지(driveFileId ${driveFileId})`,
      current ? { sizeBytes: current.sizeBytes } : {},
      () => client.downloadDriveFile(driveFileId),
      () => client.viewDriveFile(driveFileId, undefined),
    );
  }

  /** pages 요청 — source 별 /view 로 쪽 이미지를 받는다. 메일은 아직 없어 안내 문구(WP-388). superRefine 이 식별자를 확인했다. */
  function pagesFor(p: z.infer<typeof input>, pages: number[]): Promise<McpToolResult> | string {
    switch (p.source) {
      case 'issue':
        return pageBlocks(`이슈 ${p.issueKey} 첨부(attachmentId ${p.attachmentId})`, pages, (n) => client.viewIssueAttachment(p.issueKey!, p.attachmentId!, n));
      case 'drive':
        return pageBlocks(`드라이브 파일(driveFileId ${p.driveFileId})`, pages, (n) => client.viewDriveFile(p.driveFileId!, n));
      case 'wiki':
        return pageBlocks(`노트(pageId ${p.pageId}) 첨부(attachmentId ${p.attachmentId})`, pages, (n) => client.viewWikiAttachment(p.pageId!, p.attachmentId!, n));
      case 'message':
        return pageBlocks(
          `메시지(messageId ${p.messageId}) 첨부(attachmentId ${p.attachmentId})`,
          pages,
          (n) => client.viewMessageAttachment(p.channelId!, p.messageId!, p.attachmentId!, n),
        );
      case 'mail':
        return MAIL_PAGES_UNSUPPORTED;
    }
  }

  return [
    {
      name: 'read_file',
      app: ['issue', 'drive', 'wiki', 'mail', 'messaging'],
      kind: 'read',
      // WP-369 R7: 전송 도구 두 개를 정의 크기 상한 안에 넣으려고 압축했다 — 드라이브 id 출처(드라이브 앱의 목록·검색이 다 준다)·기본 길이·
      // 메일 첫 호출 안내(응답 note 가 알린다)·출력 필드 나열(응답에 그대로 보인다)·"원본은 주지 않음"(원본은 create_drive_download_link) 문장을 뺐다.
      description:
        'Reads a drive (드라이브) file or an issue (이슈), wiki page (노트), chat message (메시지) or mail (메일) attachment, by ' +
        'source: drive {driveFileId}; issue {issueKey, attachmentId from get_issue_detail}; wiki image {pageId, attachmentId in a body image ' +
        'URL .../attachments/{id}/content}; message {channelId, messageId, attachmentId = attachments[].fileId from list_channel_messages/' +
        'list_thread_replies}; mail {attachmentId from get_mail}. Text comes in slices (pass nextOffset as offset); ' +
        'truncated:true = extraction capped. Only READY has text: ' +
        'PENDING = extracting (retry soon), SKIPPED/FAILED = unreadable (relay reason), NONE = never extracted; never guess. ' +
        // WP-250: 정의 크기 상한(16,000토큰) 때문에 한 문장씩만 — 이미지를 볼 수 없는 모델에는 pages 문장을 싣지 않는다.
        // 변환본(/view)·pages 는 메일 첨부에 없다(WP-388) — 모델이 메일에 pages 를 시도하거나 HEIC 를 기대하지 않게 밝힌다.
        'Images return as images (large/HEIC converted; not mail).' +
        (imageInput ? ` PDF (not mail): pages:[n] (max ${MAX_PAGES_PER_CALL}) returns page images (figures, charts, scans).` : ''),
      inputSchema: input,
      async handler(args) {
        const p = input.parse(args);
        // pages 가 있으면 텍스트 대신 쪽 이미지만 준다(텍스트는 pages 없이 다시 부르면 된다).
        if (p.pages) return pagesFor(p, p.pages);
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
            return JSON.stringify({ attachmentId, ...rest, ...noteField(pdfNote(slice, imageInput)) });
          }
          case 'drive': {
            const driveFileId = p.driveFileId!;
            const slice = await client.readDriveFileText(driveFileId, range);
            if (isImageSkip(slice)) return driveImage(driveFileId);
            // #840: 드라이브 표면에는 core fileId 를 내보내지 않는다 — 다른 드라이브 도구와 같이 driveFileId 로만 가리킨다.
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ driveFileId, ...rest, ...noteField(driveRewriteNote(slice), pdfNote(slice, imageInput)) });
          }
          case 'wiki': {
            const pageId = p.pageId!;
            const attachmentId = p.attachmentId!;
            const slice = await client.readWikiAttachmentText(pageId, attachmentId, range);
            // 노트 업로드는 지금 이미지만 받는다 — 그래서 새 첨부는 SKIPPED·IMAGE 이고 원본을 이미지 블록으로 돌려준다.
            // 배포 전에 올린 첨부는 추출 행이 없어 NONE 인데(노트는 백필하지 않는다) 이것도 이미지라서 같은 길로 받는다 — 받은 원본을
            // 보낼 수 없으면(이미지가 아니거나 HEIC 등) 변환본(/view)에 맡기고, 서버가 형식을 거절하면(415) 그 사유를 text 로 준다(WP-250).
            // 노트·메시지·메일은 크기 메타를 알 길이 없어(목록 API 없음) 형식은 응답 Content-Type, 크기는 다운로드 상한(IMAGE_MAX_BYTES)으로 본다.
            if (isImageSkip(slice) || slice.status === 'NONE') {
              return imageBlocksFor(
                `노트(pageId ${pageId}) 첨부 이미지(attachmentId ${attachmentId})`,
                {},
                () => client.downloadWikiAttachment(pageId, attachmentId),
                () => client.viewWikiAttachment(pageId, attachmentId, undefined),
              );
            }
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ attachmentId, ...rest, ...noteField(pdfNote(slice, imageInput)) });
          }
          case 'message': {
            const channelId = p.channelId!;
            const messageId = p.messageId!;
            const attachmentId = p.attachmentId!;
            const slice = await client.readMessageAttachmentText(channelId, messageId, attachmentId, range);
            if (isImageSkip(slice)) {
              return imageBlocksFor(
                `메시지(messageId ${messageId}) 첨부 이미지(attachmentId ${attachmentId})`,
                {},
                () => client.downloadMessageAttachment(channelId, messageId, attachmentId),
                () => client.viewMessageAttachment(channelId, messageId, attachmentId, undefined),
              );
            }
            const { fileId: _coreFileId, ...rest } = slice;
            return JSON.stringify({ attachmentId, ...rest, ...noteField(pdfNote(slice, imageInput)) });
          }
          case 'mail': {
            const attachmentId = p.attachmentId!;
            const slice = await client.readMailAttachmentText(attachmentId, range);
            // 메일은 /view 가 없어(WP-388) 지금처럼 원본만 — 보낼 수 없으면 거절 안내. pages 안내(pdfNote)도 붙이지 않는다.
            if (isImageSkip(slice)) {
              // 변환본이 없어 view 를 주지 않는다 — 보낼 수 없으면 사유 안내.
              return imageBlocksFor(
                `메일 첨부 이미지(attachmentId ${attachmentId})`,
                {},
                () => client.downloadMailAttachment(attachmentId),
                undefined,
              );
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
