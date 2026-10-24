// 이슈 변경 이력(STATUS_CHANGED·PRIORITY_CHANGED·PARENT_CHANGED)의 원시 enum 값을 한국어 표시명으로 바꾼다(WP-412).
// 표시명·원문 폴백은 issueGrouping 의 statusLabel/priorityLabel 을 그대로 써서 목록·보드와 같은 단어가 나오게 하고(드리프트 방지),
// 이력 행 고유 규칙(값 없음 → '없음')만 여기서 더한다.
import { priorityLabel, statusLabel } from '@/lib/issueGrouping';
import { directionParticle } from '@/lib/utils';

/** 상태 이력 값 → 표시명. null/빈 값은 '없음'. */
export function historyStatusLabel(v: string | null): string {
  return v ? statusLabel(v) : '없음';
}

/**
 * 상태 삭제로 옮겨진 이력(STATUS_MIGRATED, WP-809) 문구 — fromValue 는 지운 상태 이름, toValue 는 옮겨 간 상태 이름.
 * 사용자의 상태 변경과 구분되게 「상태 삭제로 '코드 리뷰 중' → '진행 중'」. 값이 비면 '없음'.
 */
export function formatStatusMigrated(from: string | null, to: string | null): string {
  return `상태 삭제로 '${from || '없음'}' → '${to || '없음'}'`;
}

/** 우선순위 이력 값 → 표시명. null/빈 값은 '없음'. */
export function historyPriorityLabel(v: string | null): string {
  return v ? priorityLabel(v) : '없음';
}

/** PARENT_CHANGED 페이로드의 부모 한쪽 — 서버가 번호·제목만 보낸다. */
type ParentRef = { number: number; title?: string | null } | null | undefined;

/**
 * 부모 이슈 표기 — 「제목」(키). 제목에 띄어쓰기가 있어도 문장과 구분되게 따옴표로 감싸고 키를 붙인다(WP-862).
 * 부모는 늘 같은 프로젝트 이슈라 키는 이 프로젝트 키로 만든다. 제목이 비면 키만.
 */
function parentLabel(ref: NonNullable<ParentRef>, projectKey: string): string {
  const key = `${projectKey}-${ref.number}`;
  return ref.title ? `「${ref.title}」(${key})` : key;
}

/**
 * PARENT_CHANGED 이력 문구(WP-862) — toValue 는 {from:{number,title}|null, to:{number,title}|null} JSON.
 * 설정 「부모를 「A」(RX-1)으로 설정」·해제 「부모 「A」(RX-1) 해제」·변경 「「A」(RX-1) → 「B」(RX-2)」.
 * 조사는 괄호 앞 제목(없으면 키)의 받침으로 고른다. 파싱 실패 시 원문.
 */
export function formatParentChanged(toValue: string | null, projectKey: string): string {
  if (!toValue) return '부모 변경';
  try {
    const p = JSON.parse(toValue) as { from?: ParentRef; to?: ParentRef };
    const from = p.from ?? null;
    const to = p.to ?? null;
    if (to == null && from == null) return '부모 변경';
    if (to == null) return `부모 ${parentLabel(from!, projectKey)} 해제`;
    if (from == null) {
      const particle = directionParticle(to.title || `${projectKey}-${to.number}`);
      return `부모를 ${parentLabel(to, projectKey)}${particle} 설정`;
    }
    return `${parentLabel(from, projectKey)} → ${parentLabel(to, projectKey)}`;
  } catch {
    return toValue;
  }
}
