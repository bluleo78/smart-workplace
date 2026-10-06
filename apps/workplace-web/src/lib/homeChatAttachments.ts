// 메인 AI 채팅 첨부(WP-234) 순수 규칙 — 상한 판정·세션 첨부 수·25MB 분리·턴 첨부 변환·미리보기 해제·원본 경로.
// useHomeChatAttachments·useChatSession·homeApi 가 공유하고 vitest 로 검증한다(브라우저 없이 판정되는 부분만 모았다).
import type { ChatTurn, HomeMessage, TurnAttachment } from '@/types/home';

/** 파일당 상한 — 서버 workplace.storage.attachment 와 같은 25MB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** 메시지당 첨부 수 — 이슈 챗과 같은 10개. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** 세션당 첨부 수 — 매 턴 프롬프트에 넣는 첨부 목록 크기를 묶는다. */
export const MAX_ATTACHMENTS_PER_SESSION = 30;

/**
 * 메인 AI 채팅이 이미지(썸네일·로컬 미리보기)로 다루는 mime — api HomeAttachmentController.INLINE_MIMES·
 * ai-agent HOME_IMAGE_MIMES 와 같은 4종(정확히 일치 비교도 같다).
 */
const HOME_CHAT_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * 썸네일로 그려도 되는 이미지인지. 4종 밖의 image/*(SVG·HEIC·TIFF…)는 문서 카드(다운로드)로 보낸다 —
 * SVG 를 앱 출처 blob URL 로 새 탭에 열면 그 안의 스크립트가 앱 권한으로 돌고(self-XSS), HEIC 는 브라우저가 못 그려 깨진다.
 */
export function isHomeChatImage(mimeType: string): boolean {
  return HOME_CHAT_IMAGE_MIMES.has(mimeType);
}

/** 서버(HomeAttachmentService.tooManyMessage) 400 문구와 글자 그대로 같게 유지한다(PF-C3). */
export const PER_MESSAGE_LIMIT_MSG = `한 번에 첨부할 수 있는 파일은 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개예요.`;
/** 서버(HomeAttachmentService.MSG_SESSION_LIMIT) 400 문구와 글자 그대로 같게 유지한다(PF-C3). */
export const PER_SESSION_LIMIT_MSG = `이 대화에는 파일을 최대 ${MAX_ATTACHMENTS_PER_SESSION}개까지 첨부할 수 있어요. 새 대화를 열어 주세요.`;

/** 개수 판정 결과 — ok=false 면 message 를 토스트로 보이고 이번 묶음 전체를 올리지 않는다. */
export type CountCheck = { ok: true } | { ok: false; message: string };

/**
 * 새로 고른(붙여넣은·드롭한) 파일 묶음을 받아도 되는지 개수로 판정한다. 서버도 같은 상한으로 막지만,
 * 업로드 전에 막아야 쓸데없는 전송·임시 파일이 생기지 않는다. 둘 다 넘으면 바로 고칠 수 있는 메시지 상한을 먼저 알린다.
 *
 * @param incoming 이번 묶음의 파일 수
 * @param draftCount 입력창 초안에 이미 있는 파일 + 아직 업로드 중인 파일 수
 * @param sessionCount 현재 대화에서 이미 보낸 첨부 수
 */
export function checkAttachmentCounts(incoming: number, draftCount: number, sessionCount: number): CountCheck {
  if (draftCount + incoming > MAX_ATTACHMENTS_PER_MESSAGE) return { ok: false, message: PER_MESSAGE_LIMIT_MSG };
  if (sessionCount + draftCount + incoming > MAX_ATTACHMENTS_PER_SESSION) {
    return { ok: false, message: PER_SESSION_LIMIT_MSG };
  }
  return { ok: true };
}

/** 25MB 를 넘는 파일을 떼어 낸다 — 이미지 축소 뒤 크기로 판정해야 큰 사진이 줄어든 뒤 통과한다. */
export function splitOversize<T extends { size: number }>(files: T[]): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const f of files) (f.size > MAX_ATTACHMENT_BYTES ? rejected : accepted).push(f);
  return { accepted, rejected };
}

/** 25MB 초과 안내 — 어떤 파일이 빠졌는지 이름을 나열한다. */
export function oversizeMessage(names: string[]): string {
  return `25MB를 넘는 파일은 첨부할 수 없어요: ${names.join(', ')}`;
}

/** 현재 대화의 사용자 턴에 붙은 첨부 수 — 세션 30개 상한의 클라이언트 측 기준(복원·낙관적 턴 모두 포함). */
export function countSessionAttachments(turns: ChatTurn[]): number {
  return turns.reduce((n, t) => n + (t.role === 'user' ? (t.attachments?.length ?? 0) : 0), 0);
}

/** 영속 메시지의 첨부 → 화면 턴 첨부. 없거나 비면 undefined(첨부 없는 기존 턴과 같은 모양). */
export function toTurnAttachments(m: Pick<HomeMessage, 'attachments'>): TurnAttachment[] | undefined {
  if (!m.attachments || m.attachments.length === 0) return undefined;
  return m.attachments.map(({ fileId, originalName, mimeType, sizeBytes }) => ({ fileId, originalName, mimeType, sizeBytes }));
}

/** 턴들이 들고 있던 로컬 미리보기(blob:) URL 해제 — 새 대화·세션 복원으로 턴이 통째로 바뀔 때 호출한다. */
export function revokeTurnPreviews(turns: ChatTurn[]): void {
  for (const t of turns) {
    if (t.role !== 'user') continue;
    for (const a of t.attachments ?? []) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
  }
}

/**
 * 서버가 받아들이지 않은 전송(400·수락 전 실패)의 낙관적 사용자 턴에서 첨부를 뗀다.
 * 그대로 두면 거절된 파일이 보낸 것처럼 보이고, 세션 30개 계산에 잡혀 재전송이 이중 집계되며,
 * 초안 칩을 ×로 지울 때 초안이 해제한 blob URL 을 이 턴이 계속 그려 깨진 이미지가 된다.
 * 미리보기 URL 은 초안(입력창)이 여전히 소유하므로 여기서 해제하지 않는다.
 * 대상은 객체 동일성으로 찾는다 — 그 사이 대화가 바뀌어 턴이 없으면 배열을 그대로 돌려준다.
 */
export function withoutTurnAttachments(turns: ChatTurn[], target: ChatTurn): ChatTurn[] {
  const idx = turns.indexOf(target);
  if (idx === -1 || target.role !== 'user') return turns;
  const next = [...turns];
  const stripped = { ...target };
  delete stripped.attachments;
  next[idx] = stripped;
  return next;
}

/** 세션 첨부 원본 경로(client baseURL /api/v1 기준) — 썸네일 blob·다운로드가 공유한다. */
export function homeAttachmentContentPath(sessionId: string, fileId: number): string {
  return `/home/sessions/${sessionId}/attachments/${fileId}/content`;
}
