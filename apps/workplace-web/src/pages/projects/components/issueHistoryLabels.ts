// 이슈 변경 이력(STATUS_CHANGED·PRIORITY_CHANGED·PARENT_CHANGED)의 원시 enum 값을 한국어 표시명으로 바꾼다(WP-412).
// 표시명·원문 폴백은 issueGrouping 의 statusLabel/priorityLabel 을 그대로 써서 목록·보드와 같은 단어가 나오게 하고(드리프트 방지),
// 이력 행 고유 규칙(값 없음 → '없음')만 여기서 더한다.
import { priorityLabel, statusLabel } from '@/lib/issueGrouping';
import { relatedIssueKey } from '@/lib/issueRelations';
import { HIDDEN_PARENT_LABEL } from '@/lib/parentRef';
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

/**
 * PARENT_CHANGED 페이로드의 부모 한쪽 — 번호·제목, 다른 프로젝트 에픽이면 프로젝트 키(WP-1038). 조회자가 그 프로젝트를 읽을 수 없으면 서버가
 * {hidden:true} 로 가린다.
 */
type ParentRef = { number?: number; title?: string | null; projectKey?: string | null; hidden?: boolean } | null | undefined;

/** 부모 키 — 이력의 프로젝트 키(다른 프로젝트 에픽), 없으면(같은 프로젝트·옛 이력) 이 프로젝트 키. 가려졌으면 null. */
function parentKeyOf(ref: NonNullable<ParentRef>, projectKey: string): string | null {
  if (ref.hidden) return null;
  return `${ref.projectKey ?? projectKey}-${ref.number}`;
}

/**
 * 부모 이슈 표기 — 「제목」(키). 제목에 띄어쓰기가 있어도 문장과 구분되게 따옴표로 감싸고 키를 붙인다(WP-862).
 * 키는 부모의 프로젝트 키로 만든다(WP-1038 — 다른 프로젝트 에픽). 가려진 부모는 「볼 수 없는 에픽」, 제목이 비면 키만.
 */
function parentLabel(ref: NonNullable<ParentRef>, projectKey: string): string {
  const key = parentKeyOf(ref, projectKey);
  if (key == null) return HIDDEN_PARENT_LABEL;
  return ref.title ? `「${ref.title}」(${key})` : key;
}

/**
 * PARENT_CHANGED 이력 문구(WP-862) — toValue 는 {from:{number,title,projectKey?}|{hidden:true}|null, to:…} JSON.
 * 설정 「부모를 「A」(RX-1)으로 설정」·해제 「부모 「A」(RX-1) 해제」·변경 「「A」(RX-1) → 「B」(RX-2)」.
 * 조사는 괄호 앞 제목(없으면 키·가린 문구)의 받침으로 고른다. 파싱 실패 시 원문.
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
      const particle = directionParticle((!to.hidden && to.title) || parentKeyOf(to, projectKey) || HIDDEN_PARENT_LABEL);
      return `부모를 ${parentLabel(to, projectKey)}${particle} 설정`;
    }
    return `${parentLabel(from, projectKey)} → ${parentLabel(to, projectKey)}`;
  } catch {
    return toValue;
  }
}

/** 관계 이력의 상대(WP-887) — 조회자가 상대 프로젝트를 읽을 수 없으면 서버가 {hidden:true} 로 가린다. */
type RelationOther = { projectKey?: string; number?: number; title?: string; hidden?: boolean } | null | undefined;

/**
 * RELATION_ADDED/REMOVED 이력 문구(WP-887) — toValue 는 {typeId, label, other} JSON. 「관련 「제목」(#12)」, 다른 프로젝트면 키(WPV-28).
 * 가려진 상대는 「볼 수 없는 이슈」 — 키·제목을 드러내지 않는다. 파싱 실패·빈 값은 「관계 변경」.
 */
export function formatRelationChanged(toValue: string | null, projectKey: string): string {
  const fallback = '관계 변경';
  if (!toValue) return fallback;
  try {
    const p = JSON.parse(toValue) as { label?: string; other?: RelationOther };
    const label = p.label ?? '관계';
    const other = p.other;
    if (!other || other.hidden || !other.projectKey || other.number == null) return `${label} 볼 수 없는 이슈`;
    const key = relatedIssueKey(other.projectKey, projectKey, other.number);
    return other.title ? `${label} 「${other.title}」(${key})` : `${label} ${key}`;
  } catch {
    return fallback;
  }
}

/** 외부 링크 이력 값 한쪽 — {label, key, title, url}. */
function externalLinkText(value: string): string | null {
  const p = JSON.parse(value) as { label?: string; key?: string | null; title?: string } | null;
  if (!p || typeof p !== 'object' || !p.title) return null;
  const title = `「${p.title}」${p.key ? `(${p.key})` : ''}`;
  return p.label ? `${p.label} ${title}` : title;
}

/**
 * EXTERNAL_LINK_ADDED/UPDATED/REMOVED 이력 문구(WP-887) — 「에픽에 속함 「제목」(CL-1867)」, 수정은 「이전 → 이후」.
 * 외부 주소는 프로젝트 권한과 무관해 가리지 않는다. 파싱 실패·빈 값은 「외부 링크 변경」.
 */
export function formatExternalLinkChanged(fromValue: string | null, toValue: string | null): string {
  const fallback = '외부 링크 변경';
  if (!toValue) return fallback;
  try {
    const to = externalLinkText(toValue);
    if (!to) return fallback;
    const from = fromValue ? externalLinkText(fromValue) : null;
    return from ? `${from} → ${to}` : to;
  } catch {
    return fallback;
  }
}

/** 추가·제거 목록을 「+ A, B / - C」로 — 라벨·첨부·담당자·구성요소 이력이 같은 모양을 쓴다. 둘 다 비면 「변경 없음」. */
function addedRemoved(added: string[], removed: string[]): string {
  const parts: string[] = [];
  if (added.length) parts.push(`+ ${added.join(', ')}`);
  if (removed.length) parts.push(`- ${removed.join(', ')}`);
  return parts.length ? parts.join(' / ') : '변경 없음';
}

/**
 * {added:[{<nameKey>}], removed:[{<nameKey>}]} JSON 이력 값 → 「+ A / - B」 — 라벨·첨부·구성요소 이력이 같은 파싱·표기를 쓴다.
 * 빈 값은 emptyText, 파싱 실패는 원문. 이름이 비면 그 항목은 건너뛴다.
 */
function formatAddedRemoved(toValue: string | null, nameKey: 'name' | 'originalName', emptyText: string): string {
  if (!toValue) return emptyText;
  try {
    const p = JSON.parse(toValue) as { added?: Record<string, unknown>[]; removed?: Record<string, unknown>[] };
    const names = (list?: Record<string, unknown>[]) =>
      (list ?? []).map((x) => (typeof x[nameKey] === 'string' ? (x[nameKey] as string) : '')).filter(Boolean);
    return addedRemoved(names(p.added), names(p.removed));
  } catch {
    return toValue;
  }
}

/** LABELS_CHANGED 이력 문구 — toValue 는 {added:[{name,...}], removed:[{name,...}]} JSON. 빈 값은 「없음」, 파싱 실패는 원문. */
export function formatLabelsChanged(toValue: string | null): string {
  return formatAddedRemoved(toValue, 'name', '없음');
}

/** ATTACHMENTS_CHANGED 이력 문구 — toValue 는 {added:[{fileId,originalName}], removed:[...]} JSON. 빈 값은 「첨부 변경」. */
export function formatAttachmentsChanged(toValue: string | null): string {
  return formatAddedRemoved(toValue, 'originalName', '첨부 변경');
}

/**
 * COMPONENTS_CHANGED 이력 문구(WP-933) — toValue 는 {added:[{id,name}], removed:[{id,name}]} JSON.
 * 이름은 기록 당시 값 그대로 보인다(나중에 이름을 바꾸거나 지워도 지난 기록은 그대로). 빈 값은 「구성요소 변경」, 파싱 실패는 원문.
 */
export function formatComponentsChanged(toValue: string | null): string {
  return formatAddedRemoved(toValue, 'name', '구성요소 변경');
}

/**
 * FIX_VERSIONS_CHANGED·AFFECTS_VERSIONS_CHANGED 이력 문구(WP-888) — toValue 는 {added:[{id,name}], removed:[{id,name}]} JSON.
 * 구성요소와 같이 기록 당시 이름 그대로 「+ A / - B」로 보인다. 빈 값은 「버전 변경」, 파싱 실패는 원문.
 */
export function formatVersionsChanged(toValue: string | null): string {
  return formatAddedRemoved(toValue, 'name', '버전 변경');
}

/**
 * ASSIGNEES_CHANGED 이력 문구 — toValue 는 {added:[{id,name}], removed:[{id,name}]} JSON(이름이 비면 #id).
 * 구성요소 담당자 자동 지정(WP-933, reason=COMPONENT_DEFAULT)이면 「구성요소 Compute 담당자로 자동 지정 — 박순」으로,
 * 사람이 담당자를 바꾼 기록과 구분한다. 파싱 실패는 원문.
 */
export function formatAssigneesChanged(toValue: string | null): string {
  if (!toValue) return '담당자 변경';
  try {
    const p = JSON.parse(toValue) as {
      added?: { id: number; name?: string | null }[];
      removed?: { id: number; name?: string | null }[];
      reason?: string;
      componentName?: string;
    };
    const names = (list?: { id: number; name?: string | null }[]) => (list ?? []).map((x) => x.name ?? `#${x.id}`);
    const added = names(p.added);
    if (p.reason === 'COMPONENT_DEFAULT') {
      const who = added.length ? ` — ${added.join(', ')}` : '';
      // 이름이 없으면(옛 기록 등) 공백이 두 칸 남지 않게 이름 자리를 통째로 뺀다.
      const comp = p.componentName ? `구성요소 ${p.componentName}` : '구성요소';
      return `${comp} 담당자로 자동 지정${who}`;
    }
    return addedRemoved(added, names(p.removed));
  } catch {
    return toValue;
  }
}
