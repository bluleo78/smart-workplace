// WP-244: 공통 첨부 목록(AgentAttachment)을 러너에 맞는 프롬프트 문구로 바꾼다.
// Claude 는 이미지·PDF·텍스트를 로컬 Read 로 직접 보고, 그 외는 추출 텍스트 도구로 읽는다.
// opencode 는 빌트인 도구가 막혀 로컬 파일을 못 읽으므로 추출 텍스트 도구만 안내한다(이미지는 볼 수 없음).
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { ProviderCredential } from './agent-runner.js';
import { downloadAttachments, type DownloadOutcome } from './attachment-prep.js';
import type { AgentAttachment, CollectedAttachments } from './attachment-source.js';

export type RunnerKind = ProviderCredential['provider'];

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

/** MIME → 파일 종류. 프레젠터(다운로드·문구)와 run-chat-agent(추출 대기 판단)가 함께 쓴다. */
export function fileKind(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || TEXT_LIKE_EXTRA.has(mime)) return 'text';
  return 'other';
}

/**
 * 이 러너가 첨부 원본을 로컬에서 직접 읽을 수 있는지.
 * Claude(anthropic) 는 이미지·PDF·텍스트를 workDir 에 받아 Read 하므로 추출을 기다릴 필요가 없다.
 * opencode 는 로컬 파일을 못 읽어 추출 텍스트 도구에만 의존한다.
 */
export function readsLocally(kind: RunnerKind, mime: string): boolean {
  return kind === 'anthropic' && fileKind(mime) !== 'other';
}

/** 프롬프트에 그대로 옮겨 쓸 도구 호출 예 — 모델이 출처 인자를 헷갈리지 않게 완성형으로 준다. */
function toolCall(a: AgentAttachment): string {
  const where = a.origin.kind === 'issue' ? `issueKey:"${a.origin.issueKey}"` : `threadId:${a.origin.threadId}`;
  return `read_attachment_text({${where}, fileId:${a.fileId}})`;
}

/** 추출 상태별 한 줄(공통). READY 만 도구 호출을 안내하고, 나머지는 상태·사유만 — 재업로드 요청을 유도하지 않는다. */
function extractionLine(a: AgentAttachment): string {
  const x = a.extraction;
  switch (x.status) {
    case 'READY':
      // 글자 수를 모르면(totalChars null) "약 0자" 로 오해하지 않게 생략. truncated null 은 잘리지 않은 것으로 본다.
      return `텍스트: ${toolCall(a)}${x.totalChars != null ? ` — 약 ${x.totalChars}자` : ''}${x.truncated ? ' (추출 상한으로 잘림)' : ''}`;
    case 'PENDING':
      return '텍스트 추출 중 — 잠시 후 다시 물어봐 달라고 안내';
    case 'SKIPPED':
    case 'FAILED':
      return `텍스트로 읽을 수 없음: ${x.reason ?? '사유 미상'}`;
    default:
      return '텍스트 추출 대상 아님';
  }
}

/** 파일명의 제어문자(\r \n \t 포함)를 공백으로 — 사용자 파일명이 프롬프트 줄 구조를 깨거나 지시문을 끼워 넣지 못하게. */
function sanitizeName(name: string): string {
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
function detailLines(kind: RunnerKind, a: AgentAttachment, downloads: Map<number, DownloadOutcome>): string[] {
  const fk = fileKind(a.mimeType);
  if (readsLocally(kind, a.mimeType)) {
    const o = downloads.get(a.fileId);
    const lines = [localLine(o)];
    // PDF·텍스트는 Read 로 직접 보되, 길거나 원본을 못 받았을 때를 위해 READY 면(또는 원본이 없으면) 텍스트 도구도 병기한다.
    // 이미지는 로컬 경로만.
    if (fk !== 'image' && (a.extraction.status === 'READY' || !o || !('localPath' in o))) lines.push(extractionLine(a));
    return lines;
  }
  if (kind !== 'anthropic' && fk === 'image') return ['이 비서(모델)는 이미지를 볼 수 없음 — 내용을 글로 알려 달라고 안내'];
  return [extractionLine(a)];
}

// 두 러너 공통 문장 — 추출 상태가 READY 가 아닐 때의 응대 규칙.
const GUIDANCE_COMMON =
  '추출 중이거나 읽을 수 없는 첨부는 그 상태와 사유를 알리고, 다시 올려 달라고 요청하지 마세요.';
const GUIDANCE_CLAUDE =
  '첨부는 위 안내대로 읽으세요: 로컬경로는 Read, 텍스트는 read_attachment_text(필요한 만큼만 읽고, 더 필요하면 결과의 nextOffset 을 offset 으로 넘겨 이어 읽기). ' +
  GUIDANCE_COMMON;
const GUIDANCE_OPENCODE =
  '첨부는 위 안내대로 read_attachment_text 로 읽으세요(필요한 만큼만 읽고, 더 필요하면 결과의 nextOffset 을 offset 으로 넘겨 이어 읽기). ' +
  GUIDANCE_COMMON;

/** 이슈 첨부 목록을 못 불러왔을 때의 줄 — 목록이 비어 보여도 "첨부 없음" 으로 단정하지 않게 한다(I1). */
const ISSUE_LIST_FAILED_LINE = '- [이슈 첨부] 목록을 불러올 수 없음(권한 등) — 이슈에 첨부가 없다고 단정하지 말 것';

export async function presentAttachments(
  kind: RunnerKind,
  collected: CollectedAttachments,
  deps: { client: WorkplaceApiClient; agentId: number; workDir: string },
): Promise<PresentedAttachments> {
  const { attachments, issueListFailed } = collected;
  if (attachments.length === 0) {
    // 이슈 목록 실패면 "첨부 없음" 대신 실패 줄만 — 읽을 첨부가 없으니 읽는 방법 안내는 필요 없다.
    return { section: issueListFailed ? ISSUE_LIST_FAILED_LINE : '첨부 없음', guidance: '' };
  }

  // Claude 만 원본을 받는다 — 이미지·PDF·텍스트처럼 Read 로 직접 볼 수 있는 것만(오피스는 원본이 쓸모없다).
  // 텍스트는 추출이 PENDING/NONE/FAILED 여도 Claude 가 원본을 읽을 수 있어야 한다.
  const downloads =
    kind === 'anthropic'
      ? await downloadAttachments(
          deps.client,
          deps.agentId,
          attachments.filter((a) => readsLocally(kind, a.mimeType)),
          deps.workDir,
        )
      : new Map<number, DownloadOutcome>();

  const lines = attachments.map((a) =>
    [header(a), ...detailLines(kind, a, downloads).map((l) => `  - ${l}`)].join('\n'),
  );
  if (issueListFailed) lines.unshift(ISSUE_LIST_FAILED_LINE);
  const section = lines.join('\n');
  return { section, guidance: kind === 'anthropic' ? GUIDANCE_CLAUDE : GUIDANCE_OPENCODE };
}
