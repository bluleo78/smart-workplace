// src/attachment-view.ts — 서버가 그린 "모델 입력용 이미지"(/view, WP-250)를 MCP 블록으로 바꾸는 공통 헬퍼.
// read_file(공유)과 ai-agent 전용 첨부 읽기 도구가 같이 쓴다. 두 갈래가 있다:
//  · PDF 페이지 — 모델이 pages:[n] 로 고른 쪽을 서버가 이미지로 그려 준다(그림·도표·스캔은 텍스트 추출로 못 읽어서).
//  · 이미지 — 그대로 보낼 수 있으면(JPEG·PNG·GIF·WebP, 3.75MB 이하) 원본, 아니면(HEIC·TIFF·BMP·큰 이미지) 서버 변환본.
// 이미지 블록은 대화 내내 매 턴 다시 실려 요청 크기(Messages API 32MB)를 키우므로 호출당·실행당 장수를 묶는다(ImageBudget).
import { z } from 'zod';

import { baseMimeType, FileTooLargeError, IMAGE_MAX_BYTES, imageRejectReasons, SENDABLE_IMAGE_MIMES, toBase64 } from './attachment-read.js';
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
/** 한 번의 실행에서 볼 수 있는 최대 이미지 수 — 이전 이미지가 매 턴 다시 실려도 요청 크기 상한에 닿지 않게. */
export const IMAGE_BUDGET_PER_RUN = 20;

/** 예산을 다 썼을 때 모델에 주는 안내 — 같은 요청을 되풀이하지 않고 사용자에게 범위를 좁혀 달라고 하게 한다. cap 은 실제 상한. */
const usedUpNotice = (cap: number) =>
  `이번 대화에서 볼 수 있는 이미지를 다 썼습니다(${cap}장). 볼 페이지를 좁혀 달라고 사용자에게 요청하세요.`;

/**
 * 실행당 이미지 상한 — 도구 서버 인스턴스(= 한 번의 에이전트 실행)마다 하나를 만들어 도구들이 같이 쓴다.
 * 받기 전에 take 로 잡아 두고(다 썼으면 받지 않는다), 모델에 실제로 주지 못한 장수는 refund 로 돌려놓는다 —
 * 예산은 "모델에 넘긴 이미지 장수"를 센다(실패한 쪽·거절 안내로 끝난 이미지는 세지 않는다). 잡아 두기는 병렬 호출이 같이 넘치지 않게 한다.
 */
export class ImageBudget {
  private remaining: number;
  constructor(readonly cap: number) {
    this.remaining = cap;
  }
  /** n 장을 잡는다 — 모자라면 잡지 않고 false(더 적은 장수 요청은 여전히 받을 수 있다). */
  take(n: number): boolean {
    if (n > this.remaining) return false;
    this.remaining -= n;
    return true;
  }
  /** 잡았지만 주지 못한 n 장을 돌려놓는다(상한을 넘겨 늘리지는 않는다). */
  refund(n: number): void {
    this.remaining = Math.min(this.cap, this.remaining + Math.max(0, n));
  }
  /** take(requested) 가 false 일 때 모델에 줄 안내 — 남은 장수가 있으면 그만큼 줄여 다시 부르게, 없으면 실제 상한으로 다 썼다고. */
  shortfall(requested: number): string {
    if (this.remaining === 0) return usedUpNotice(this.cap);
    return `이번 대화에서 볼 수 있는 이미지가 ${this.remaining}장 남았습니다(요청 ${requested}장). ${this.remaining}장 이하로 줄여 다시 요청하세요.`;
  }
}

/**
 * 예산을 n 장 잡고 run 을 돌린 뒤, 결과에 실제로 실린 이미지 장수만 남기고 나머지는 돌려놓는다(run 이 던져도 전부 돌려놓는다).
 * 예산이 모자라면 run 을 부르지 않고 안내만 돌려준다. budget 이 없으면(외부 MCP) 그냥 run.
 */
export async function withImageBudget(
  budget: ImageBudget | undefined,
  n: number,
  run: () => Promise<McpToolResult>,
): Promise<McpToolResult> {
  if (!budget) return run();
  if (!budget.take(n)) return budget.shortfall(n);
  let delivered = 0;
  try {
    const out = await run();
    if (typeof out !== 'string') delivered = out.filter((b) => b.type === 'image').length;
    return out;
  } finally {
    budget.refund(n - delivered);
  }
}

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
 * 이미지 입력 옵션 — input 은 모델이 이미지를 볼 수 있는지, budget 은 실행당 이미지 예산(없으면 호출당 상한만).
 * read_file(공유)과 ai-agent 첨부 도구가 같은 모양으로 받는다.
 */
export interface ImageOptions {
  input: boolean;
  budget?: ImageBudget;
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
 * 페이지들을 한꺼번에(병렬로) 받아 요청 순서대로 블록으로. 예산은 중복을 뺀 장수만큼 받기 전에 잡고, 실패한 쪽만큼 돌려놓는다(withImageBudget).
 * 쪽마다 서버 왕복(캐시가 없으면 워커 렌더)이 있어 차례로 받으면 3쪽 요청이 세 배 걸린다 — 결과는 받은 순서가 아니라 요청 순서로 싣는다.
 * 서버 오류(범위 밖 400·손상 422·렌더 실패 503 등)는 던지지 않고 그 쪽의 사유를 text 로 돌려준다 — 모델이 범위를 고쳐 다시 부르게.
 * 일부 쪽만 실패하면 받은 쪽의 이미지 뒤에 실패 사유를 붙이고, 같은 사유는 쪽 번호를 묶어 한 줄로 쓴다(403·404·415 는 모든 쪽이 같다).
 */
export async function pageBlocks(
  label: string,
  pages: number[],
  fetch: (page: number) => Promise<FileBytes>,
  budget?: ImageBudget,
): Promise<McpToolResult> {
  const unique = [...new Set(pages)];
  return withImageBudget(budget, unique.length, async () => {
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
  });
}

/** 변환본 받기 — 서버 오류는 사유를 text 로(이미지 내용을 추측하지 않고 그대로 전하게). */
async function viewOrNotice(label: string, view: () => Promise<FileBytes>): Promise<McpToolResult> {
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
 * 이미지: 보낼 수 있으면 원본, 아니면 /view 변환본. 메타(목록의 형식·크기)를 알면 먼저 보고 원본을 받지 않는다.
 * 메타를 모르면 원본을 시도하고, 다운로드 상한 초과(FileTooLargeError)나 받은 형식·크기가 보낼 수 없는 것이면 변환본으로 잇는다.
 * view 가 없으면(메일 첨부 — /view 가 없다, WP-388) 변환본 대신 보낼 수 없는 사유를 안내한다.
 * 다른 다운로드 오류(권한·없음)는 삼키지 않는다 — 도구 레이어가 API 오류로 알린다.
 */
export async function imageBlocksFor(
  label: string,
  meta: { mimeType?: string; sizeBytes?: number },
  download: () => Promise<FileBytes>,
  view: (() => Promise<FileBytes>) | undefined,
  budget?: ImageBudget,
): Promise<McpToolResult> {
  return withImageBudget(budget, 1, () => originalOrConverted(label, meta, download, view));
}

/** imageBlocksFor 의 본체(예산 밖) — 원본을 보낼 수 있으면 원본, 아니면 변환본(없으면 사유 안내). */
async function originalOrConverted(
  label: string,
  meta: { mimeType?: string; sizeBytes?: number },
  download: () => Promise<FileBytes>,
  view: (() => Promise<FileBytes>) | undefined,
): Promise<McpToolResult> {
  // 보낼 수 없을 때 — 변환본이 있으면 변환본, 없으면 사유 안내.
  const fallback = (reasons: string[]) => (view ? viewOrNotice(label, view) : imageNotice(label, reasons));
  // 아는 메타만 본다 — 형식을 모르면 형식을, 크기를 모르면 크기를 따지지 않는다(받은 뒤 다시 본다).
  const badType = meta.mimeType !== undefined && !SENDABLE_IMAGE_MIMES.has(baseMimeType(meta.mimeType));
  const tooBig = meta.sizeBytes !== undefined && meta.sizeBytes > IMAGE_MAX_BYTES;
  if (badType || tooBig) {
    return fallback([...(badType ? [`형식(${meta.mimeType})`] : []), ...(tooBig ? [`크기(${meta.sizeBytes}B)`] : [])]);
  }
  let bytes: FileBytes;
  try {
    bytes = await download();
  } catch (e) {
    if (e instanceof FileTooLargeError) return fallback([`크기(${IMAGE_MAX_BYTES}B 초과)`]);
    throw e;
  }
  const reasons = imageRejectReasons(baseMimeType(bytes.mimeType), bytes.data.byteLength);
  return reasons.length > 0 ? fallback(reasons) : viewBlocks(label, bytes);
}
