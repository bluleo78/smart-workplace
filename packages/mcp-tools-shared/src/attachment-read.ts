// src/attachment-read.ts — 첨부·파일 내용 읽기의 공통 계약(WP-346).
// 공유 read_attachment(이슈 첨부·드라이브 파일)와 ai-agent 전용 read_chat_attachment(메인 AI 채팅 세션 첨부)·
// read_chat_thread_attachment(이슈 챗 스레드 첨부)가 같은 구간 범위·기본 길이·이미지 판정 규칙을 쓰도록 여기 한 곳에 둔다.
// (예전에는 ai-agent 의 attachment-read-schema.ts·home-attachment-tool.ts 에 있었다 — 공유 도구가 생기며 옮겼다.)
import { z } from 'zod';

// limit 미지정 시 기본 구간 길이. 서버 기본(32000)보다 작게 — 컨텍스트가 작은 모델이 한 번에 너무 많이 받지 않게 한다.
// 더 필요하면 모델이 limit 을 최대 32000 까지 직접 지정하거나 nextOffset 으로 이어 읽는다.
export const READ_ATTACHMENT_DEFAULT_LIMIT = 12000;

// limit 상한 32000 은 서버 계약(WP-242·WP-346)과 같다 — 드라이브는 넘기면 자르고 이슈 첨부는 400 이라 스키마에서 먼저 막는다.
// 선택 인자는 nullish — 모델이 안 쓰는 인자를 null 로 채워 보내는 경우가 있어 null 도 "미지정" 으로 받는다.
export const readRangeShape = {
  offset: z.number().int().min(0).nullish(),
  limit: z.number().int().min(1).max(32000).nullish(),
};

/** 파싱한 범위 → 클라이언트 범위. offset 생략은 서버 기본(0), limit 생략은 READ_ATTACHMENT_DEFAULT_LIMIT. */
export function resolveRange(p: { offset?: number | null; limit?: number | null }): { offset?: number; limit: number } {
  return { offset: p.offset ?? undefined, limit: p.limit ?? READ_ATTACHMENT_DEFAULT_LIMIT };
}

/** 모델에 이미지 블록으로 보낼 수 있는 형식 — Claude·opencode 비전 모델 공통 입력 형식. */
export const SENDABLE_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** 이미지 원본 상한 3.75MB — base64(×4/3)로 늘면 모델 이미지 한도 5MB 에 닿는다. */
export const IMAGE_MAX_BYTES = 3_932_160;

/** Content-Type 원문에서 파라미터(charset 등)를 떼고 소문자로 — 모델 입력 형식 비교·전달용. */
export function baseMimeType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

/**
 * 이미지 블록으로 보낼 수 없는 사유 — 빈 배열이면 보낼 수 있다. 실제 사유만 돌려준다:
 * 형식만 문제인데 크기까지 탓하면 모델이 엉뚱한 안내를 한다. sizeBytes 를 모르면(undefined) 크기는 따지지 않는다.
 */
export function imageRejectReasons(mimeType: string, sizeBytes: number | undefined): string[] {
  const reasons: string[] = [];
  if (!SENDABLE_IMAGE_MIMES.has(baseMimeType(mimeType))) reasons.push(`형식(${mimeType})`);
  if (sizeBytes !== undefined && sizeBytes > IMAGE_MAX_BYTES) reasons.push(`크기(${sizeBytes}B)`);
  return reasons;
}

/** 이미지 블록으로 보낼 수 있는지 — 형식과 원본 크기 모두 만족해야 한다. */
export function isSendableImage(a: { mimeType: string; sizeBytes: number }): boolean {
  return imageRejectReasons(a.mimeType, a.sizeBytes).length === 0;
}

/** 원본 바이트 → base64(MCP image 블록 data). */
export function toBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
}
