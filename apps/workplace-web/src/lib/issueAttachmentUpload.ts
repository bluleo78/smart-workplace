// 이슈 첨부 업로드의 순수 판정 — 남은 자리에 맞춰 파일 자르기, 결과 토스트 문구, 남은 개수 힌트.
// 왜: 한도(20)를 넘는 파일마다 토스트를 쌓지 않고 결과 하나로 알리기 위해(WP-2118). jsdom 없이 판정되도록 순수 함수로 둔다.

import { toast } from 'sonner';

/** 힌트를 보이기 시작하는 남은 자리 상한 — 남은 자리 1~5 일 때만 「· n개 남음」. */
const REMAINING_HINT_MAX = 5;

/**
 * 현재 첨부 수 기준으로 남은 자리만큼 앞에서부터 받고 나머지는 제외한다.
 * 순서를 지켜 사용자가 고른 앞쪽 파일이 우선 붙게 한다.
 */
export function splitByRemaining(
  files: File[],
  currentCount: number,
  max: number,
): { accepted: File[]; excluded: File[] } {
  const room = Math.max(0, max - currentCount);
  return { accepted: files.slice(0, room), excluded: files.slice(room) };
}

/** 업로드 결과 토스트 — 레벨(넘침 없음 success · 일부만 붙음 warning · 하나도 못 붙음 error)·제목·설명을 한 곳에서 정한다. */
export function uploadResultMessage(
  added: number,
  excludedNames: string[],
  max: number,
): { level: 'success' | 'warning' | 'error'; title: string; description?: string } {
  if (excludedNames.length === 0) return { level: 'success', title: `${added}개 첨부를 추가했습니다` };
  return {
    level: added === 0 ? 'error' : 'warning',
    title: `첨부 ${added}개 · 제외 ${excludedNames.length}개 — 이슈당 최대 ${max}개`,
    description: `제외: ${excludedNames.join(', ')}`,
  };
}

/** 한도 안내 한 줄 — 한도 도달이면 「한도 도달 · 최대 N개」, 남은 1~5 면 remainingHint, 아니면 null. 드롭존·모바일이 한 번만 계산해 그린다. */
export function attachmentLimitLabel(count: number, max: number): string | null {
  if (count >= max) return `한도 도달 · 최대 ${max}개`;
  return remainingHint(count, max);
}

/** 첨부가 막힌 때 안내 문구 — 업로드 중이면 다시 시도 안내, 한도 도달이면 한도 문구. 드롭존·모바일이 같은 문구를 쓴다. */
export function blockedUploadMessage(reason: 'uploading' | 'limit', max: number, action: '드롭' | '선택' = '드롭'): string {
  if (reason === 'uploading') return `업로드 중입니다. 끝난 뒤 다시 ${action}해 주세요`;
  return attachmentLimitLabel(max, max) ?? '';
}

/** 막힌 안내 토스트의 고정 id — 막힌 클릭·드롭을 반복해도 토스트가 쌓이지 않고 앞의 것을 바꾼다. */
export const BLOCKED_UPLOAD_TOAST_ID = 'attachment-blocked';

/** 막힌 업로드 이유를 토스트 하나로 알린다 — 드롭존·모바일 스트립이 같은 문구·같은 id 를 쓴다(WP-2118). */
export function notifyBlockedUpload(reason: 'uploading' | 'limit', max: number, action: '드롭' | '선택' = '드롭'): void {
  toast.info(blockedUploadMessage(reason, max, action), { id: BLOCKED_UPLOAD_TOAST_ID });
}

/** 남은 자리가 1~5 일 때만 「· n개 남음」, 그 외(여유 많음·0)는 null — 한도 도달은 호출자가 따로 보인다. */
export function remainingHint(count: number, max: number): string | null {
  const left = max - count;
  return left >= 1 && left <= REMAINING_HINT_MAX ? `· ${left}개 남음` : null;
}
