// WP-244: 공통 첨부 목록(AgentAttachment)을 러너에 맞는 프롬프트 문구로 바꾼다.
// Claude 는 모델에 보낼 수 있는 이미지·텍스트를 로컬 Read 로 직접 보고, 그 외(PDF·오피스·HEIC/큰 이미지)는 도구
// read_chat_thread_attachment 로 읽는다. PDF 는 Read 가 큰 파일에서 poppler(pdftoppm)를 요구하는데 운영 ai-agent 이미지에 없어
// 도구로 통일했다(WP-250) — 도구가 추출 텍스트와, 이미지를 볼 수 있는 모델에는 pages 로 쪽 이미지를 준다.
// opencode 는 비전 지원 모델(WP-241 판단)일 때만 보낼 수 있는 이미지를 로컬 read 로 보고(WP-236 의 read 허용 범위),
// 그 외 파일은 도구로 읽는다 — custom provider 모델은 PDF 입력을 못 받는다. 비전이 아니면 pages 는 안내하지 않는다(도구도 숨김).
import { baseMimeType, canViewPages, isSendableImage, MAX_PAGES_PER_CALL } from '@smart-workplace/mcp-tools-shared';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { ProviderCredential } from './agent-runner.js';
import { downloadAttachments, type DownloadOutcome } from './attachment-prep.js';
import type { AgentAttachment, CollectedAttachments } from './attachment-source.js';

type RunnerKind = ProviderCredential['provider'];

/**
 * 첨부를 읽는 쪽(러너+모델)의 능력. imageVision 은 모델이 이미지를 볼 수 있는지 —
 * Claude 는 항상 true, opencode 는 resolveOpencodeModelVision 이 true 로 판단한 경우만(알 수 없음은 false 로 본다).
 */
export interface AttachmentReader {
  runner: RunnerKind;
  imageVision: boolean;
}

export interface PresentedAttachments {
  section: string; // 프롬프트 "## 첨부파일" 본문
  guidance: string; // 첨부 읽는 방법 안내(첨부 없으면 빈 문자열)
}

export type FileKind = 'image' | 'pdf' | 'text' | 'other';

// 서버 ExtractableTypes 의 TEXT_LIKE_EXTRA 와 같은 목록 — text/* 외에 텍스트로 읽을 수 있는 application/* 타입.
// 서버와 어긋나면 Claude 가 원본을 받는 범위와 추출 대상 범위가 달라지므로 함께 갱신할 것.
const TEXT_LIKE_EXTRA = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/javascript',
  'application/x-sh',
]);

/**
 * MIME → 파일 종류. 프레젠터(다운로드·문구)와 run-chat-agent(추출 대기 판단)가 함께 쓴다. 파라미터(charset 등)는 떼고 본다.
 * 옛 octet-stream HEIC·TIFF·BMP 사진은 V174 가 데이터에서 이미지 mime 으로 바로잡아(WP-250) 파일명으로 다시 판별하지 않는다.
 */
export function fileKind(mimeType: string): FileKind {
  const mime = baseMimeType(mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || TEXT_LIKE_EXTRA.has(mime)) return 'text';
  return 'other';
}

/**
 * 이 러너·모델이 첨부 원본을 로컬에서 직접 읽을 수 있는지 — true 면 workDir 에 원본을 받는다.
 * Claude(anthropic) 는 텍스트와, 모델에 보낼 수 있는 이미지(jpeg/png/gif/webp ≤3.75MB)를 Read 하므로 추출을 기다릴 필요가 없다.
 * HEIC·큰 이미지는 서버 변환본이 필요해 도구로, PDF 는 poppler 없이 읽히도록(WP-250) 도구로 보낸다 — 그래서 크기도 본다.
 * opencode 는 비전 모델일 때 보낼 수 있는 이미지만 read 로 본다. 나머지는 도구에 의존한다.
 */
export function readsLocally(reader: AttachmentReader, a: { mimeType: string; sizeBytes: number }): boolean {
  const fk = fileKind(a.mimeType);
  if (reader.runner === 'anthropic') return fk === 'text' || (fk === 'image' && isSendableImage(a));
  return fk === 'image' && reader.imageVision && isSendableImage(a);
}

/**
 * 프롬프트에 그대로 옮겨 쓸 도구 호출 예 — 모델이 인자를 헷갈리지 않게 완성형으로 준다.
 * 이슈 첨부·챗 첨부 모두 스레드 경유로 읽으므로 형태가 같다(WP-244 — 이슈 첨부 API 는 비멤버 에이전트에 403).
 */
function toolCall(a: AgentAttachment, pagesArg = ''): string {
  return `read_chat_thread_attachment({threadId:${a.origin.threadId}, fileId:${a.fileId}${pagesArg}})`;
}

/** 줄마다 붙이는 재업로드 금지 — 스캔 PDF 등에서 모델이 "텍스트 레이어 있는 PDF 로 다시 올려 달라" 고 제안한 사례가 있어 줄 자체에 붙인다. */
const NO_REUPLOAD = '다시 올리거나 다른 형식으로 올려 달라고 하지 말 것';

/**
 * 추출 상태별 한 줄(공통). READY 만 도구 호출을 안내하고, 나머지는 상태·사유만 — 재업로드 요청을 유도하지 않는다.
 * pdfPages(WP-250): 이미지를 볼 수 있는 모델이 PDF 를 읽을 때 — 텍스트와 함께 pages 로 쪽 이미지를 볼 수 있다고 알리고,
 * 글자 없는 스캔 PDF 는 pages 로 읽게 한다. 이미지를 볼 수 없는 모델이면 pages 는 말하지 않고 모델 전환을 안내한다.
 */
function extractionLine(a: AgentAttachment, pdfPages = false): string {
  const x = a.extraction;
  const isPdf = fileKind(a.mimeType) === 'pdf';
  if (isPdf && x.status === 'SKIPPED' && x.reasonCode === 'SCANNED_PDF') {
    if (pdfPages) {
      // 쪽수를 모르는 이전 추출 행은 쪽수 없이 말한다(pageCount null·생략).
      return `글자 없는 스캔 PDF${x.pageCount ? `(${x.pageCount}쪽)` : ''} — pages 로 페이지 이미지를 읽으세요: ${toolCall(a, ', pages:[n]')} — ${NO_REUPLOAD}`;
    }
    return `텍스트로 읽을 수 없음: ${x.reason ?? '사유 미상'} — 이미지를 볼 수 있는 모델로 바꾸면 읽을 수 있음(비서 설정) — ${NO_REUPLOAD}`;
  }
  // WP-250 코드 리뷰: Claude 도 PDF 를 로컬 Read 하지 않으므로, 추출 행이 없거나(NONE — 추출 기능 전 업로드) 실패했거나 스캔이 아닌 사유로
  // 건너뛴 PDF 도 이미지를 볼 수 있는 모델이면 페이지 이미지로 읽게 한다 — 그렇지 않으면 읽을 길이 없다. 쪽수를 모르면 1쪽부터 보게 하고,
  // 범위를 넘으면 서버가 실제 쪽수를 알려 준다(400). 100MB 를 넘는 PDF 는 서버가 그리지 않으므로(413) 약속하지 않는다.
  if (canViewPages(a, pdfPages) && x.status !== 'READY' && x.status !== 'PENDING') {
    const why = x.status === 'NONE' ? '텍스트 추출 기록 없음' : `텍스트로 읽을 수 없음: ${x.reason ?? '사유 미상'}`;
    const pages = x.pageCount ? `(총 ${x.pageCount}쪽)` : '(쪽수를 모르면 pages:[1] 부터)';
    return `${why} — pages 로 페이지 이미지를 읽으세요${pages}: ${toolCall(a, ', pages:[n]')} — ${NO_REUPLOAD}`;
  }
  switch (x.status) {
    case 'READY': {
      // 글자 수를 모르면(totalChars null) "약 0자" 로 오해하지 않게 생략. truncated null 은 잘리지 않은 것으로 본다.
      const chars = x.totalChars != null ? `약 ${x.totalChars}자` : '';
      const pages = pdfPages && x.pageCount ? `총 ${x.pageCount}쪽` : '';
      const meta = [chars, pages].filter(Boolean).join(', ');
      return `${pdfPages && isPdf ? '텍스트·페이지' : '텍스트'}: ${toolCall(a)}${meta ? ` — ${meta}` : ''}${x.truncated ? ' (추출 상한으로 잘림)' : ''}`;
    }
    case 'PENDING':
      return '텍스트 추출 중 — 잠시 후 다시 물어봐 달라고 안내';
    case 'SKIPPED':
    case 'FAILED':
      return `텍스트로 읽을 수 없음: ${x.reason ?? '사유 미상'} — ${NO_REUPLOAD}`;
    default:
      return '텍스트 추출 대상 아님';
  }
}

/** 파일명의 제어문자(\r \n \t 포함)를 공백으로 — 사용자 파일명이 프롬프트 줄 구조를 깨거나 지시문을 끼워 넣지 못하게. 메인 AI 채팅 첨부 블록(WP-234)도 같이 쓴다. */
export function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001F\u007F]/g, ' ');
}

function header(a: AgentAttachment): string {
  const where = a.origin.kind === 'issue' ? '이슈 첨부' : '챗 첨부';
  return `- [${where}] ${sanitizeName(a.originalName)} (${a.mimeType}, ${a.sizeBytes}B)`;
}

function localLine(o: DownloadOutcome | undefined): string {
  if (!o) return '로컬 파일 없음';
  return 'localPath' in o ? `로컬경로: ${o.localPath}` : `원본 건너뜀: ${o.skipReason}`;
}

/** 항목별 하위 줄 — 러너·파일 종류·추출 상태 조합. */
function detailLines(reader: AttachmentReader, a: AgentAttachment, downloads: Map<number, DownloadOutcome>): string[] {
  const fk = fileKind(a.mimeType);
  if (readsLocally(reader, a)) {
    const o = downloads.get(a.fileId);
    const lines = [localLine(o)];
    const got = o && 'localPath' in o;
    // 텍스트는 Read 로 직접 보되, 길거나 원본을 못 받았을 때를 위해 READY 면(또는 원본이 없으면) 텍스트 도구도 병기한다.
    if (fk !== 'image' && (a.extraction.status === 'READY' || !got)) lines.push(extractionLine(a));
    // 이미지 원본을 못 받았으면(상한 초과 등) 도구가 같은 이미지를 대신 준다 — 로컬 경로 없이 막히지 않게.
    if (fk === 'image' && !got) lines.push(`이미지: ${toolCall(a)}`);
    return lines;
  }
  if (fk === 'image') {
    // 비전이면 로컬로 못 보는 이미지(HEIC·큰 이미지)를 도구로 — 서버가 변환본을 준다. 비전이 아니면 기존 안내.
    return reader.imageVision
      ? [`이미지: ${toolCall(a)}`]
      : ['이 비서(모델)는 이미지를 볼 수 없음 — 내용을 글로 알려 달라고 안내'];
  }
  return [extractionLine(a, reader.imageVision)];
}

const TEXT_TOOL_HOW =
  'read_chat_thread_attachment(필요한 만큼만 읽고, 더 필요하면 결과의 nextOffset 을 offset 으로 넘겨 이어 읽기)';
// 공통 문장 — 추출 상태가 READY 가 아닐 때의 응대 규칙.
const GUIDANCE_COMMON =
  '추출 중이거나 읽을 수 없는 첨부는 그 상태와 사유를 알리고, 다시 올려 달라거나 다른 형식(텍스트 PDF 등)으로 올려 달라는 제안도 하지 마세요.';

// 이미지를 볼 수 있는 모델에만 하는 pages 안내(WP-250) — 도구 설명(PAGES_DESCRIPTION)과 같은 뜻.
const PAGES_HOW = `그림·도표·스캔은 pages:[n](PDF, 한 번에 최대 ${MAX_PAGES_PER_CALL}쪽)로 페이지 이미지를 보세요`;

/** 첨부 읽는 방법 안내 — 로컬경로를 읽는 도구(Claude Read, 비전 opencode 는 소문자 read)만 러너·모델별로 다르다. */
function guidanceFor(reader: AttachmentReader): string {
  const how =
    reader.runner === 'anthropic'
      ? `로컬경로(이미지·텍스트 파일)는 Read, 문서·PDF 는 ${TEXT_TOOL_HOW} — ${PAGES_HOW}`
      : reader.imageVision
        ? `로컬경로(이미지)는 read, 문서·PDF 는 ${TEXT_TOOL_HOW} — ${PAGES_HOW}`
        : TEXT_TOOL_HOW;
  return `첨부는 위 안내대로 읽으세요: ${how}. ${GUIDANCE_COMMON}`;
}

/** 이슈 첨부 목록을 못 불러왔을 때의 줄 — 목록이 비어 보여도 "첨부 없음" 으로 단정하지 않게 한다(I1). */
const ISSUE_LIST_FAILED_LINE = '- [이슈 첨부] 목록을 불러올 수 없음(권한 등) — 이슈에 첨부가 없다고 단정하지 말 것';

export async function presentAttachments(
  reader: AttachmentReader,
  collected: CollectedAttachments,
  deps: { client: WorkplaceApiClient; agentId: number; workDir: string },
): Promise<PresentedAttachments> {
  const { attachments, issueListFailed } = collected;
  if (attachments.length === 0) {
    // 이슈 목록 실패면 "첨부 없음" 대신 실패 줄만 — 읽을 첨부가 없으니 읽는 방법 안내는 필요 없다.
    return { section: issueListFailed ? ISSUE_LIST_FAILED_LINE : '첨부 없음', guidance: '' };
  }

  // 로컬로 직접 볼 수 있는 것만 원본을 받는다(오피스·PDF 는 도구로 읽는다) — Claude 는 보낼 수 있는 이미지·텍스트,
  // 비전 opencode 는 보낼 수 있는 이미지만. 텍스트는 추출이 PENDING/NONE/FAILED 여도 Claude 가 원본을 읽을 수 있어야 한다.
  const downloads = await downloadAttachments(
    deps.client,
    deps.agentId,
    attachments.filter((a) => readsLocally(reader, a)),
    deps.workDir,
  );

  const lines = attachments.map((a) =>
    [header(a), ...detailLines(reader, a, downloads).map((l) => `  - ${l}`)].join('\n'),
  );
  if (issueListFailed) lines.unshift(ISSUE_LIST_FAILED_LINE);
  const section = lines.join('\n');
  return { section, guidance: guidanceFor(reader) };
}
