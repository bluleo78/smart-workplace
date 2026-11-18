// src/source-fields.ts — read_file(attachment-tools)과 upload_file 의 source 갈래(file-tools, WP-1705)가 함께 쓰는 source 별 식별자 표와 검사.
// 두 도구의 규칙·문구가 갈라지지 않게 한 곳에 둔다.
import { z } from 'zod';

/** source 별 필수 식별자 — 나머지 식별자는 줄 수 없다. 필드 이름은 입력 이름 그대로다(드라이브만 driveFileId, 나머지 첨부는 attachmentId 를 재사용). */
export const SOURCE_FIELDS = {
  // WP-1331: 본문·댓글에 넣은 이미지는 attachments 에 없다 — 이미지 주소 .../issue-images/{id} 의 id 로 같은 source 를 읽는다.
  issue: { required: ['issueKey', 'attachmentId'], from: 'get_issue_detail 의 attachments[].attachmentId 또는 본문 이미지 주소 .../issue-images/{id}' },
  issue_chat: { required: ['issueKey', 'messageId', 'attachmentId'], from: 'get_issue_chat 의 messages[].id 와 attachments[].attachmentId' },
  drive: { required: ['driveFileId'], from: 'list_drive_items·search_drive 결과의 driveFileId' },
  wiki: { required: ['pageId', 'attachmentId'], from: '노트 본문 이미지 주소 .../attachments/{attachmentId}/content' },
  message: { required: ['channelId', 'messageId', 'attachmentId'], from: 'list_channel_messages·list_thread_replies 항목의 id 와 attachments[].fileId, 그 채널의 channelId' },
  mail: { required: ['attachmentId'], from: 'get_mail 의 attachments[].attachmentId' },
} as const;
export const IDENTIFIER_FIELDS = ['issueKey', 'attachmentId', 'driveFileId', 'pageId', 'channelId', 'messageId'] as const;

/**
 * source 별 필수 식별자가 다 있는지, 다른 source 의 식별자를 함께 주지 않았는지 확인한다(superRefine 본문).
 * WP-1705: upload_file 의 source 갈래(첨부 복사)도 read_file 과 같은 식별자·같은 표로 검사한다 — 두 도구의 규칙·문구가 갈라지지 않게.
 */
export function checkSourceFields(
  v: Record<string, unknown> & { source: keyof typeof SOURCE_FIELDS },
  ctx: z.RefinementCtx,
): void {
  const { required, from } = SOURCE_FIELDS[v.source];
  const missing = required.filter((f) => v[f] == null);
  if (missing.length > 0) {
    ctx.addIssue({ code: 'custom', message: `source '${v.source}' 는 ${required.join('·')} 가 필요합니다(${from}).` });
  }
  const extra = IDENTIFIER_FIELDS.filter((f) => v[f] != null && !(required as readonly string[]).includes(f));
  if (extra.length > 0) {
    ctx.addIssue({ code: 'custom', message: `source '${v.source}' 에는 ${extra.join('·')} 를 주지 마세요. 다른 첨부는 그 source 로 읽습니다.` });
  }
}

/** 서버가 스테이징 복사를 지원하는 source(WP-1705) — upload_file 의 zod enum 과 StagedCopySourceName 타입이 이 한 상수에서 나온다. */
export const STAGED_COPY_SOURCES = ['issue', 'issue_chat', 'drive'] as const;

/** 복사 source 들이 쓰는 식별자 — upload_file 이 source 없이 이 식별자만 주는 것을 막는 데 쓴다(SOURCE_FIELDS 의 필수 목록에서 모은다). */
export const COPY_ID_FIELDS = IDENTIFIER_FIELDS.filter((f) =>
  STAGED_COPY_SOURCES.some((s) => (SOURCE_FIELDS[s].required as readonly string[]).includes(f)),
);
