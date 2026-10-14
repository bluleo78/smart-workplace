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
/** 한 번의 실행에서 볼 수 있는 최대 이미지 수 — 이전 이미지가 매 턴 다시 실려도 요청 크기 상한에 닿지 않게. */
export const IMAGE_BUDGET_PER_RUN = 20;

/** 예산을 다 썼을 때 모델에 주는 안내 — 같은 요청을 되풀이하지 않고 사용자에게 범위를 좁혀 달라고 하게 한다. cap 은 실제 상한. */
const usedUpNotice = (cap: number) =>
  `이번 대화에서 볼 수 있는 이미지를 다 썼습니다(${cap}장). 볼 페이지를 좁혀 달라고 사용자에게 요청하세요.`;
/** 기본 상한(IMAGE_BUDGET_PER_RUN)을 다 썼을 때의 안내 — 예산이 하나도 남지 않았을 때 ImageBudget.shortfall 이 돌려주는 문구와 같다. */
export const IMAGE_BUDGET_EXHAUSTED = usedUpNotice(IMAGE_BUDGET_PER_RUN);

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
  const res = (e as { response?: { status?: number; data?: unknown } })?.response;
  if (res && res.data !== undefined) return describeApiError(res.status, res.data);
  return e instanceof Error ? e.message : String(e);
}

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
 * 페이지들을 차례로 받아 블록으로. 예산은 중복을 뺀 장수만큼 받기 전에 잡고, 실패한 쪽만큼 돌려놓는다(withImageBudget).
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
    const blocks: McpContent[] = [];
    // 사유 → 실패한 쪽 번호(삽입 순서 유지).
    const failures = new Map<string, number[]>();
    for (const n of unique) {
      try {
        const v = await fetch(n);
        blocks.push(...viewBlocks(`${label} ${n}쪽${v.pageCount ? `(전체 ${v.pageCount}쪽)` : ''}`, v));
      } catch (e) {
        const reason = viewErrorText(e);
        failures.set(reason, [...(failures.get(reason) ?? []), n]);
      }
    }
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
  return withImageBudget(budget, 1, () => originalOrConverted(label, meta, download, view));
}

/** imageBlocksFor 의 본체(예산 밖) — 원본을 보낼 수 있으면 원본, 아니면 변환본. */
async function originalOrConverted(
  label: string,
  meta: { mimeType?: string; sizeBytes?: number },
  download: () => Promise<FileBytes>,
  view: () => Promise<FileBytes>,
): Promise<McpToolResult> {
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
