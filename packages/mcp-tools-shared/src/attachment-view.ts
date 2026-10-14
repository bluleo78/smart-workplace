// src/attachment-view.ts — 서버가 그린 "모델 입력용 이미지"(/view, WP-250)를 MCP 블록으로 바꾸는 공통 헬퍼.
// read_file(공유)과 ai-agent 전용 첨부 읽기 도구가 같이 쓴다. 두 갈래가 있다:
//  · PDF 페이지 — 모델이 pages:[n] 로 고른 쪽을 서버가 이미지로 그려 준다(그림·도표·스캔은 텍스트 추출로 못 읽어서).
//  · 이미지 — 그대로 보낼 수 있으면(JPEG·PNG·GIF·WebP, 3.75MB 이하) 원본, 아니면(HEIC·TIFF·BMP·큰 이미지) 서버 변환본.
// 이미지 블록은 대화 내내 매 턴 다시 실려 요청 크기(Messages API 32MB)를 키우므로 호출당·실행당 장수를 묶는다(ImageBudget).
import { z } from 'zod';

import { baseMimeType, FileTooLargeError, IMAGE_MAX_BYTES, imageRejectReasons, SENDABLE_IMAGE_MIMES, toBase64 } from './attachment-read.js';
import type { McpContent, McpToolResult } from './mcp-content.js';
import { errText } from './parse.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { FileBytes } from './tool-client.js';

/**
 * 실행당 이미지 상한 — 도구 서버 인스턴스(= 한 번의 에이전트 실행)마다 하나를 만들어 도구들이 같이 쓴다.
 * take 가 false 면 다 쓴 것이다(이때는 차감하지 않는다 — 더 적은 장수 요청은 여전히 받을 수 있다).
 */
export class ImageBudget {
  constructor(private remaining: number) {}
  take(n: number): boolean {
    if (n > this.remaining) return false;
    this.remaining -= n;
    return true;
  }
}

/** 한 번의 read_file 호출로 볼 수 있는 최대 쪽수. */
export const MAX_PAGES_PER_CALL = 3;
/** 한 번의 실행에서 볼 수 있는 최대 이미지 수 — 이전 이미지가 매 턴 다시 실려도 요청 크기 상한에 닿지 않게. */
export const IMAGE_BUDGET_PER_RUN = 20;
/** 예산을 다 썼을 때 모델에 주는 안내 — 같은 요청을 되풀이하지 않고 사용자에게 범위를 좁혀 달라고 하게 한다. */
export const IMAGE_BUDGET_EXHAUSTED =
  '이번 대화에서 볼 수 있는 이미지를 다 썼습니다(20장). 볼 페이지를 좁혀 달라고 사용자에게 요청하세요.';

/** pages 입력 — 1부터, 1~3개. 중복은 핸들러가 한 번만 본다. null 은 "미지정"(모델이 쓰지 않는 인자를 null 로 채우는 경우). */
export const pagesShape = { pages: nullAsOmitted(z.array(z.number().int().min(1)).min(1).max(MAX_PAGES_PER_CALL)) };

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
 * 페이지들을 차례로 받아 블록으로. 예산은 중복을 뺀 장수만큼 먼저 차감한다(받는 도중 실패해도 되돌리지 않는다 — 단순하게).
 * 서버 오류(범위 밖 400·손상 422·렌더 실패 503 등)는 던지지 않고 그 쪽의 사유를 text 로 돌려준다 — 모델이 범위를 고쳐 다시 부르게.
 * 일부 쪽만 실패하면 받은 쪽의 이미지와 실패한 쪽의 사유를 함께 준다.
 */
export async function pageBlocks(
  label: string,
  pages: number[],
  fetch: (page: number) => Promise<FileBytes>,
  budget?: ImageBudget,
): Promise<McpToolResult> {
  const unique = [...new Set(pages)];
  if (budget && !budget.take(unique.length)) return IMAGE_BUDGET_EXHAUSTED;
  const blocks: McpContent[] = [];
  for (const n of unique) {
    try {
      const v = await fetch(n);
      blocks.push(...viewBlocks(`${label} ${n}쪽${v.pageCount ? `(전체 ${v.pageCount}쪽)` : ''}`, v));
    } catch (e) {
      blocks.push({ type: 'text', text: `${label} ${n}쪽: ${errText(e)}` });
    }
  }
  return collapse(blocks);
}

/** 변환본 받기 — 서버 오류는 사유를 text 로(이미지 내용을 추측하지 않고 그대로 전하게). */
async function viewOrNotice(label: string, view: () => Promise<FileBytes>): Promise<McpToolResult> {
  try {
    return viewBlocks(label, await view());
  } catch (e) {
    return `${label}: ${errText(e)}`;
  }
}

/**
 * 이미지: 보낼 수 있으면 원본, 아니면 /view 변환본. 메타(목록의 형식·크기)를 알면 먼저 보고 원본을 받지 않는다.
 * 메타를 모르면 원본을 시도하고, 다운로드 상한 초과(FileTooLargeError)나 받은 형식·크기가 보낼 수 없는 것이면 변환본으로 잇는다.
 * 다른 다운로드 오류(권한·없음)는 삼키지 않는다 — 도구 레이어가 API 오류로 알린다.
 */
export async function imageBlocksFor(
  label: string,
  meta: { mimeType?: string; sizeBytes?: number },
  download: () => Promise<FileBytes>,
  view: () => Promise<FileBytes>,
  budget?: ImageBudget,
): Promise<McpToolResult> {
  if (budget && !budget.take(1)) return IMAGE_BUDGET_EXHAUSTED;
  // 아는 메타만 본다 — 형식을 모르면 형식을, 크기를 모르면 크기를 따지지 않는다(받은 뒤 다시 본다).
  const badType = meta.mimeType !== undefined && !SENDABLE_IMAGE_MIMES.has(baseMimeType(meta.mimeType));
  const tooBig = meta.sizeBytes !== undefined && meta.sizeBytes > IMAGE_MAX_BYTES;
  if (badType || tooBig) return viewOrNotice(label, view);
  let bytes: FileBytes;
  try {
    bytes = await download();
  } catch (e) {
    if (e instanceof FileTooLargeError) return viewOrNotice(label, view);
    throw e;
  }
  if (imageRejectReasons(bytes.mimeType, bytes.data.byteLength).length > 0) return viewOrNotice(label, view);
  return viewBlocks(label, bytes);
}
