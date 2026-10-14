// src/attachment-view.ts — 서버가 그린 "모델 입력용 이미지"(/view, WP-250)를 MCP 블록으로 바꾸는 공통 헬퍼.
// read_file(공유)과 ai-agent 전용 첨부 읽기 도구가 같이 쓴다. 두 갈래가 있다:
//  · PDF 페이지 — 모델이 pages:[n] 로 고른 쪽을 서버가 이미지로 그려 준다(그림·도표·스캔은 텍스트 추출로 못 읽어서).
//  · 이미지 — 늘 서버 변환본(긴 변 1568px 이하로 줄인 JPEG·PNG). 변환본이 없는 메일 첨부(WP-388)만 보낼 수 있는 원본을 그대로 쓴다.
// 한 번의 호출로 보는 쪽수는 MAX_PAGES_PER_CALL 로 묶는다. 실행 전체의 이미지 누적은 세지 않는다 — 긴 실행은 러너의 컨텍스트 압축에 맡긴다.
import { z } from 'zod';

import { baseMimeType, FileTooLargeError, IMAGE_MAX_BYTES, imageRejectReasons, toBase64 } from './attachment-read.js';
import type { McpContent, McpToolResult } from './mcp-content.js';
import { describeApiError } from './parse.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { FileBytes } from './tool-client.js';

/** 한 번의 read_file 호출로 볼 수 있는 최대 쪽수. */
export const MAX_PAGES_PER_CALL = 3;
/** 서버 /view 원본 상한(AttachmentViewService.MAX_SOURCE_BYTES, 워커 config.MAX_BYTES)과 같은 25MB — 넘는 PDF 는 페이지를 그리지 않는다(413). */
export const MAX_VIEW_SOURCE_BYTES = 25 * 1024 * 1024;
/** 모델이 이미지를 볼 수 있을 때 ai-agent 첨부 도구(read_chat_attachment·read_chat_thread_attachment) 설명에 덧붙이는 pages 한 문장. */
export const PAGES_DESCRIPTION = `PDF 는 pages:[n](최대 ${MAX_PAGES_PER_CALL}쪽)로 쪽 이미지를 볼 수 있습니다(그림·도표·스캔).`;

/**
 * /view 실패 사유 한 줄 — 서버 응답이 있으면 describeApiError 로 요약한다(ErrorResponse 의 한국어 message, JSON 이 아닌 본문은 300자로 자름 —
 * 프록시 502·504 HTML 을 통째로 모델에 넘기지 않게). 응답이 없으면(네트워크 오류·plain Error) message.
 */
function viewErrorText(e: unknown): string {
  // /view 바이트가 다운로드 상한을 넘은 경우 — 원본이 아니라 서버가 변환한 이미지가 큰 것이라 주어를 바꿔 알린다.
  if (e instanceof FileTooLargeError) return `변환한 이미지가 ${e.maxBytes}B 를 넘어 받지 않았습니다.`;
  const res = (e as { response?: { status?: number; data?: unknown } })?.response;
  if (res && res.data !== undefined) return describeApiError(res.status, res.data);
  return e instanceof Error ? e.message : String(e);
}

/** pages 입력 — 1부터, 1~3개. 중복은 핸들러가 한 번만 본다. null 은 "미지정"(모델이 쓰지 않는 인자를 null 로 채우는 경우). */
export const pagesShape = { pages: nullAsOmitted(z.array(z.number().int().min(1)).min(1).max(MAX_PAGES_PER_CALL)) };

/**
 * 이미지 입력 옵션 — input 은 모델이 이미지를 볼 수 있는지.
 * read_file(공유)과 ai-agent 첨부 도구가 같은 모양으로 받는다.
 */
export interface ImageOptions {
  input: boolean;
}

/**
 * 첨부 읽기 입력 스키마에 pages 를 더한다 — 이미지를 볼 수 있는 모델(imageInput)에만. 못 쓰는 인자를 스키마·정의에 두지 않기 위해서다.
 * 뺀 판도 타입은 pages 를 선택 필드로 갖게 해(값은 늘 없다) 핸들러가 한 모양으로 다룬다.
 */
export function withPages<T extends z.ZodRawShape>(base: z.ZodObject<T>, imageInput: boolean) {
  return (imageInput ? base.extend(pagesShape) : base) as z.ZodObject<T> & z.ZodObject<typeof pagesShape>;
}

/**
 * PDF 를 페이지 이미지로 볼 수 있다고 안내해도 되는지 — 이미지를 볼 수 있는 모델이고 25MB 이하 PDF 일 때(넘으면 서버가 413).
 * 글자로 못 읽는 PDF(추출 기록 없음·실패·건너뜀)의 pages 안내를 프롬프트·도구 결과가 같은 기준으로 붙이게 한다. 상태 조건은 호출자가 따로 본다.
 */
export function canViewPages(a: { mimeType: string; sizeBytes: number }, imageInput: boolean): boolean {
  return imageInput && baseMimeType(a.mimeType) === 'application/pdf' && a.sizeBytes <= MAX_VIEW_SOURCE_BYTES;
}

/** /view 바이트 → [설명 text, image] 블록. 형식은 응답 Content-Type 에서 파라미터를 뗀 값(모델 입력 형식). */
export function viewBlocks(label: string, v: FileBytes): McpContent[] {
  const mimeType = baseMimeType(v.mimeType);
  return [
    { type: 'text', text: `${label} (${mimeType}, ${v.data.byteLength}B)` },
    { type: 'image', data: toBase64(v.data), mimeType },
  ];
}

/** 블록이 모두 text 면 한 문자열로 — 오류 안내만 있을 때 모델이 문자열 결과로 받게 한다(기존 도구 결과와 같은 모양). */
function collapse(blocks: McpContent[]): McpToolResult {
  return blocks.every((b) => b.type === 'text') ? blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n') : blocks;
}

/**
 * 페이지들을 한꺼번에(병렬로) 받아 요청 순서대로 블록으로. 같은 쪽 번호가 겹치면 한 번만 받는다.
 * 쪽마다 서버 왕복(캐시가 없으면 워커 렌더)이 있어 차례로 받으면 3쪽 요청이 세 배 걸린다 — 결과는 받은 순서가 아니라 요청 순서로 싣는다.
 * 서버 오류(범위 밖 400·손상 422·렌더 실패 503 등)는 던지지 않고 그 쪽의 사유를 text 로 돌려준다 — 모델이 범위를 고쳐 다시 부르게.
 * 일부 쪽만 실패하면 받은 쪽의 이미지 뒤에 실패 사유를 붙이고, 같은 사유는 쪽 번호를 묶어 한 줄로 쓴다(403·404·415 는 모든 쪽이 같다).
 */
export async function pageBlocks(
  label: string,
  pages: number[],
  fetch: (page: number) => Promise<FileBytes>,
): Promise<McpToolResult> {
  const unique = [...new Set(pages)];
  // allSettled — 한 쪽이 실패해도 나머지 쪽은 그대로 받는다. 결과 배열은 unique 와 같은 순서다.
  const settled = await Promise.allSettled(unique.map((n) => fetch(n)));
  const blocks: McpContent[] = [];
  // 사유 → 실패한 쪽 번호(요청 순서 유지).
  const failures = new Map<string, number[]>();
  settled.forEach((r, i) => {
    const n = unique[i];
    if (r.status === 'fulfilled') {
      blocks.push(...viewBlocks(`${label} ${n}쪽${r.value.pageCount ? `(전체 ${r.value.pageCount}쪽)` : ''}`, r.value));
    } else {
      const reason = viewErrorText(r.reason);
      failures.set(reason, [...(failures.get(reason) ?? []), n]);
    }
  });
  for (const [reason, failed] of failures) blocks.push({ type: 'text', text: `${label} ${failed.join('·')}쪽: ${reason}` });
  return collapse(blocks);
}

/**
 * 이미지 파일 → 서버 변환본(/view) 블록. 원본이 보낼 수 있는 형식·크기(JPEG·PNG·GIF·WebP, 3.75MB 이하)여도 변환본을 쓴다 —
 * 원본은 해상도를 줄이지 않아 4000×3000 사진이 그대로 가고, 한 요청에 이미지가 20장을 넘으면 Anthropic Messages API 가 긴 변 2000px 넘는
 * 이미지를 거절(400)한다(실행당 장수 상한이 없어 긴 실행은 20장을 넘는다). 변환본은 워커가 긴 변 1568px 이하로 줄이고(작은 이미지는 키우지 않는다)
 * 서버가 원본 옆에 캐시해 두 번째부터는 워커를 거치지 않는다.
 * 서버 오류(형식 미지원 415·손상 422·렌더 실패 503·권한 403 등)는 던지지 않고 사유를 text 로 준다 — 이미지 내용을 추측하지 않고 그대로 전하게(pageBlocks 와 같다).
 */
export async function imageViewBlocks(label: string, view: () => Promise<FileBytes>): Promise<McpToolResult> {
  try {
    return viewBlocks(label, await view());
  } catch (e) {
    return `${label}: ${viewErrorText(e)}`;
  }
}

/** 보낼 수 없는 이미지 안내(변환본이 없는 메일 첨부, WP-388) — 실제 사유만 말하고, 내용을 추측하지 않게 한다. label 은 JSON 으로 감싸 제어문자를 무력화한 이름·식별자. */
function imageNotice(label: string, reasons: string[]): string {
  return (
    `${label}: 이 이미지의 ${reasons.join('과 ')}는 모델에 보낼 수 없습니다(JPEG·PNG·GIF·WebP, ${IMAGE_MAX_BYTES}B 이하만 가능). ` +
    '이미지 내용을 추측하지 말고, 사용자에게 직접 확인해 달라고 안내하세요.'
  );
}

/**
 * 변환본(/view)이 없는 이미지(메일 첨부, WP-388) — 원본을 받아 보낼 수 있는 형식·크기면 그대로, 아니면 사유를 안내한다.
 * 크기 메타가 없어 다운로드 상한(IMAGE_MAX_BYTES)으로 보고, 넘으면(FileTooLargeError) 크기 사유로 안내한다.
 * 다른 다운로드 오류(권한·없음)는 삼키지 않는다 — 도구 레이어가 API 오류로 알린다.
 */
export async function originalImageBlocks(label: string, download: () => Promise<FileBytes>): Promise<McpToolResult> {
  let bytes: FileBytes;
  try {
    bytes = await download();
  } catch (e) {
    if (e instanceof FileTooLargeError) return imageNotice(label, [`크기(${IMAGE_MAX_BYTES}B 초과)`]);
    throw e;
  }
  const reasons = imageRejectReasons(baseMimeType(bytes.mimeType), bytes.data.byteLength);
  return reasons.length > 0 ? imageNotice(label, reasons) : viewBlocks(label, bytes);
}
