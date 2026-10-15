// WP-386 공용 메모리 화면 로직 — 공간 쿼리 값(?space=PROJECT:12)·링크, 공간 검색, 안내 문구, 행 메타, 기록 화면 모델, 화면 맥락 → 채팅 공간.
// 발화자 추적 금지(스펙 6.3): 대화에서 뽑힌 항목의 메타에 이름을 붙이지 않고, 기록 모델에 출처 대화(source)를 싣지 않는다.
import { CHANGE_UNDO_REFUSED_MESSAGE, type MemoryChangeLogEntry } from '@/components/ai/memoryChangeLogEntry';
import { MEMORY_SETTINGS_PATH } from '@/lib/aiMemory';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type {
  ChatSpace,
  SharedAiMemoryChange,
  SharedAiMemoryItem,
  SharedMemoryChangeAction,
  SharedMemorySpace,
  SharedSpaceRef,
  SharedSpaceType,
} from '@/types/sharedAiMemory';

/** 공간 목록 묶음(서버 정렬 순서와 같다). 조직 묶음의 소제목은 「조직」, 그 안의 공간 이름은 spaceLabel 의 「조직 지침」(시안 v2). */
export const SPACE_GROUPS: { type: SharedSpaceType; label: string }[] = [
  { type: 'ORG', label: '조직' },
  { type: 'PROJECT', label: '프로젝트' },
  { type: 'WIKI_SPACE', label: '노트 스페이스' },
];

/** 공간이 이보다 많으면 공간 검색칸을 보인다(스펙 8절). */
export const SPACE_SEARCH_OVER = 10;

/** 공용 메모리 탭 쿼리 키 — `?memoryTab=shared&space=PROJECT:12`. */
export const MEMORY_TAB_PARAM = 'memoryTab';
export const SPACE_PARAM = 'space';

export function spaceParam(ref: SharedSpaceRef): string {
  return ref.type === 'ORG' ? 'ORG' : `${ref.type}:${ref.id}`;
}

/** 쿼리 값 → 공간. 형식이 틀리면 null(화면은 첫 공간을 고른다). */
export function parseSpaceParam(v: string | null): SharedSpaceRef | null {
  if (v === 'ORG') return { type: 'ORG', id: null };
  const m = /^(PROJECT|WIKI_SPACE):([1-9]\d*)$/.exec(v ?? '');
  return m ? { type: m[1] as SharedSpaceType, id: Number(m[2]) } : null;
}

/** 화면에 보이는 공간 이름 — 조직은 API label(「조직」) 대신 「조직 지침」(묶음 소제목과 겹치지 않게), 나머지는 API label 그대로. */
export function spaceLabel(s: Pick<SharedMemorySpace, 'type' | 'label'>): string {
  return s.type === 'ORG' ? '조직 지침' : s.label;
}

export function refOf(s: SharedMemorySpace): SharedSpaceRef {
  return { type: s.type, id: s.id };
}

export function sameSpace(a: SharedSpaceRef | null, b: SharedSpaceRef | null): boolean {
  return a != null && b != null && a.type === b.type && (a.id ?? null) === (b.id ?? null);
}

/** 그 공간이 고른 설정 화면 주소. */
export function sharedMemoryHref(ref: SharedSpaceRef): string {
  const p = new URLSearchParams({ [MEMORY_TAB_PARAM]: 'shared', [SPACE_PARAM]: spaceParam(ref) });
  return `${MEMORY_SETTINGS_PATH}?${p.toString()}`;
}

/** 공간 검색 — 이름·라벨·키(대소문자 무시). */
export function filterSpaces(spaces: readonly SharedMemorySpace[], q: string): SharedMemorySpace[] {
  const t = q.trim().toLowerCase();
  if (!t) return [...spaces];
  return spaces.filter((s) => [s.name, s.label, spaceLabel(s), s.key ?? ''].some((v) => v.toLowerCase().includes(t)));
}

const NOUN: Record<Exclude<SharedSpaceType, 'ORG'>, string> = { PROJECT: '프로젝트', WIKI_SPACE: '스페이스' };

/** 공간 설명 + 내 권한 한 줄(시안 v2 문구, 대화한 사람의 편집은 없음 — 스펙 8절). */
export function spaceHint(s: SharedMemorySpace): string {
  if (s.type === 'ORG') {
    return s.canManage
      ? '조직의 모든 AI 대화에 반영돼요. 관리자만 쓰고 고칠 수 있고, AI는 바꾸지 않아요.'
      : '조직의 모든 AI 대화에 반영돼요. 관리자만 바꿀 수 있어요.';
  }
  const base = `이 ${NOUN[s.type]}에서 일하는 모든 AI가 읽어요. 대화에서 나온 팀 규칙은 AI가 기억하고 정리해요. 팀 모두에게 적용되는 규칙만 적어 주세요.`;
  if (s.canManage) return `${base} 모든 항목을 고치고 지울 수 있어요.`;
  return s.canAdd ? `${base} 고치기·지우기는 내가 추가했거나 요청한 항목만 할 수 있어요.` : base;
}

/** 기록 대화상자 안내. */
export function historyIntro(s: SharedMemorySpace): string {
  if (s.canManage) return '최근 90일 동안 바뀐 내용이에요. 항목마다 되돌릴 수 있어요.';
  return s.canAdd
    ? '최근 90일 동안 바뀐 내용이에요. 내가 추가했거나 요청한 항목은 되돌릴 수 있어요.'
    : '최근 90일 동안 바뀐 내용이에요.';
}

/** 행 메타(날짜 앞) — 대화에서 뽑힌 항목은 누구에게나 이름 없이. */
export function sharedRowMeta(item: SharedAiMemoryItem): string {
  switch (item.origin) {
    case 'USER_REQUESTED':
      return item.author ? `${item.author.name} 요청` : '요청';
    case 'USER_ADDED':
      return item.author ? `${item.author.name} 직접 추가` : '직접 추가';
    case 'AI_CLEANED':
      return 'AI가 정리';
    case 'AI_EXTRACTED':
      return '대화에서 AI가 기억';
  }
}

const LABEL: Record<SharedMemoryChangeAction, string> = {
  ADDED: '새로 기억함',
  UPDATED: '고침',
  MERGED: '합침',
  DELETED: '지움',
  RESTORED: '되돌림',
};

/** API 기록 → 공용 기록 목록 모델(WP-385 MemoryChangeLog). source 는 싣지 않는다. */
export function toSharedChangeLogEntry(c: SharedAiMemoryChange): MemoryChangeLogEntry {
  const showBefore = c.action === 'UPDATED' || c.action === 'MERGED';
  // 시안 v2: 「직접 추가함」(다른 동작과 같은 ~함 꼴).
  const label = c.action === 'ADDED' && c.memory?.origin === 'USER_ADDED' ? '직접 추가함' : LABEL[c.action];
  return {
    id: c.id,
    at: c.createdAt,
    icon: c.action,
    label,
    actor: c.actor.kind === 'AI' ? 'AI' : (c.actor.name ?? '알 수 없는 사용자'),
    content: c.memory?.content ?? c.before[0]?.content ?? '',
    removed: c.action === 'DELETED',
    before: showBefore ? c.before.map((b) => b.content) : [],
    ...(showBefore ? { beforeLabel: c.action === 'MERGED' ? '합치기 전' : '이전' } : {}),
    undoneAt: c.undoneAt,
    undoable: c.undoable,
  };
}

/** 되돌리기 실패 코드 → 문구(CHANGED 문구는 개인 기록과 같은 상수를 쓴다). 없는 코드는 서버 문구(handleApiError). */
export const SHARED_UNDO_ERROR: Record<string, string> = {
  SHARED_MEMORY_CHANGED: CHANGE_UNDO_REFUSED_MESSAGE,
  SHARED_MEMORY_CHANGE_UNDONE: '이미 되돌린 기록이에요',
  SHARED_MEMORY_FORBIDDEN: '되돌릴 권한이 없어요',
  SHARED_MEMORY_FULL: '공용 메모리가 가득 차 되돌릴 수 없어요',
  // 보관 기간(90일)이 지났거나 프로젝트·스페이스가 지워져 기록이 사라진 뒤 결과 줄 「되돌리기」를 누른 경우.
  SHARED_MEMORY_NOT_FOUND: '이 기록은 더 이상 되돌릴 수 없어요',
};

/**
 * 화면 맥락 → 홈 채팅 요청의 공간(스펙 6.1). 프로젝트 키(범위 refs 먼저, 없으면 대상 refs)면 프로젝트, 노트 화면의 spaceId 면 노트 스페이스.
 * 드라이브 등 다른 앱의 spaceId 는 공간이 아니다. 서버가 권한을 다시 확인하므로 여기서는 모양만 본다.
 */
export function spaceOfScreenContext(ctx: AiScreenContext | null | undefined): ChatSpace | null {
  if (!ctx) return null;
  const projectKey = ctx.scope?.refs?.projectKey ?? ctx.focus?.refs.projectKey;
  if (projectKey) return { type: 'PROJECT', key: projectKey };
  if (ctx.app === 'WIKI') {
    const raw = ctx.scope?.refs?.spaceId ?? ctx.focus?.refs.spaceId;
    const id = raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
    if (id != null) return { type: 'WIKI_SPACE', id };
  }
  return null;
}
