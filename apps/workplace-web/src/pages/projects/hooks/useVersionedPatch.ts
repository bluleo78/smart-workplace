// 편집 기준 version 을 지키는 이슈 필드 저장(#611) — 팀 이슈 상세(제목·본문)와 개인 작업 상세(메모)가 함께 쓴다(WP-1374).
// 왜: 제목·본문은 편집을 시작한 순간의 version 을 저장 기준으로 고정해야, 편집하는 사이 코멘트 SSE·창 포커스 리페치로 캐시 version 이
// 올라가도 그 사이 다른 사람(AI 포함)이 바꾼 내용을 모른 채 덮어쓰지 않고 409 로 알 수 있다. 그 기준을 올리고 푸는 규칙을 한 곳에 둔다.
// WP-2095: 409 가 나면 최신 상세를 받아 「그 필드 값이 편집 시작 값과 달라졌는지」를 필드별로 판정한다 — 달라졌으면 충돌 상태로 두고
// (기준 version 을 풀지 않아 다시 저장해도 덮어쓰지 않는다), 다른 필드만 바뀐 409 는 최신 version 으로 한 번 자동 재저장한다.
import { useEffect, useRef, useState } from 'react';

import { handleApiError, isVersionConflictError } from '@/lib/api-error';
import type { IssueDetailResponse, UpdateIssueRequest } from '@/types/issue';

/** 저장 mutation 의 필요한 부분만 — useUpdateIssue 결과를 그대로 넘긴다. */
interface UpdateMutation {
  mutateAsync: (changes: UpdateIssueRequest) => Promise<IssueDetailResponse>;
}

/** 저장이 쓴 필드와 값 — 내 저장 version 기록과 외부 변경 알림이 같은 모양을 쓴다. */
export type SavedFields = Partial<Record<'title' | 'body', string>>;

/** 내 저장 version 기록을 남기는 최대 개수 — 오래된 것부터 지운다(상세는 최근 version 만 읽는다). */
const MAX_SAVED_VERSIONS = 20;

/** 필드 충돌 — 남이 먼저 저장한 최신 값과 그 시점의 이슈 version(덮어쓰기 기준). */
export interface FieldConflict {
  latest: string;
  latestVersion: number;
}

/** 409 뒤 받아 온 최신 상세에서 이 훅이 다루는 필드 값만 뽑은 것. */
export interface LatestValues<F extends string> {
  version: number;
  values: Record<F, string>;
}

export interface VersionedPatch<F extends string> {
  /** 필드 저장 — 성공 여부를 돌려준다(편집기가 실패 시 입력을 버리지 않고 편집을 다시 연다). changes 의 title/body 키로 필드를 안다. */
  patch: (changes: UpdateIssueRequest) => Promise<boolean>;
  /** 편집 진입 — 지금 보고 있는 version 을 기준으로, 편집 시작 값을 함께 고정하고 그 필드의 충돌을 지운다. */
  beginEdit: (field: F, value: string) => void;
  /** 편집 종료(취소·저장 성공) — 기준·시작 값·충돌을 지운다. */
  endEdit: (field: F) => void;
  /** 이 필드의 저장 기준 version — 저장 요청의 version 으로 싣는다. 기준이 없으면 undefined(useUpdateIssue 가 캐시 version 을 쓴다). */
  baseVersion: (field: F) => number | undefined;
  /** 이 필드의 충돌(렌더 상태) — 없으면 null. */
  conflict: (field: F) => FieldConflict | null;
  /** 「내 글로 덮어쓰기」 — 안내에 보여 준 최신 version 을 기준으로 삼고 충돌을 지운다(그 뒤 또 바뀌었으면 다음 저장이 다시 409). */
  overwrite: (field: F) => void;
  /** 「최신으로 다시 쓰기」 — 기준을 최신 version·시작 값을 최신 값으로 옮기고 충돌을 지운 뒤 최신 값을 돌려준다.
   *  충돌이 없으면 null — 돌려줄 최신 값이 없으므로 편집기는 입력을 그대로 둔다(빈 값·시작 값으로 입력을 지우지 않게). */
  takeLatest: (field: F) => string | null;
  /** 「최신으로 다시 쓰기」 뒤 되살린 내 글 — 그 필드의 충돌을 최신 값으로 다시 연다(기준 version 은 takeLatest 가 옮겨 둔 최신 그대로). */
  reopenConflict: (field: F, latest: string) => void;
  /** 편집 중 남이 저장했는가 — 기준·시작 값이 있고 충돌이 없으며, 현재 version 이 기준보다 올랐고 현재 값이 시작 값과 다르다. */
  changedWhileEditing: (field: F, current: string | undefined, currentVersion: number | undefined) => boolean;
  /** 내 저장 응답으로 받은 version → 그 저장이 쓴 필드와 값 — 다른 사람의 저장과 구분하는 재료(WP-2095, useExternalEditNotice). */
  savedVersions: () => ReadonlyMap<number, SavedFields>;
}

/** 이슈 필드 중 충돌 판정 대상 — changes 의 이 키들로 어떤 필드를 저장하는지 안다. */
const FIELD_KEYS = ['title', 'body'] as const;

/**
 * update — useUpdateIssue 결과(409 토스트를 끄는 quietConflict 로 만든 것). currentVersion — 지금 화면이 보고 있는 이슈 version(로드 전이면 undefined).
 * fetchLatest — 409 때 최신 상세를 실제로 다시 받아 오는 함수.
 * scope — 어느 이슈인지 가리는 값(예: 'WP-12'). 라우트가 컴포넌트를 재사용해 이슈만 바뀌어도 이전 이슈의 기준·충돌·내 저장 version 이
 * 새 이슈에 섞이지 않도록 값이 바뀌면 모두 비운다. 넘기지 않으면(개인 작업 패널) 비우지 않는다.
 */
export function useVersionedPatch<F extends 'title' | 'body'>(
  update: UpdateMutation,
  currentVersion: number | undefined,
  fetchLatest: () => Promise<LatestValues<F>>,
  scope?: string,
): VersionedPatch<F> {
  // 필드별 편집 기준 version·시작 값 — 렌더에 쓰지 않으므로 ref(바뀌어도 다시 그리지 않는다).
  const bases = useRef<Partial<Record<F, number>>>({});
  const starts = useRef<Partial<Record<F, string>>>({});
  // 충돌은 안내를 그려야 하므로 상태, 같은 틱의 동기 조회용으로 ref 에도 미러한다.
  const conflictsRef = useRef<Partial<Record<F, FieldConflict>>>({});
  // 충돌 상태에 어느 이슈(scope)의 것인지 함께 둔다 — 이슈가 바뀐 첫 렌더에는 effect 초기화가 아직 돌기 전이라,
  // scope 가 다른 상태는 렌더에서 「충돌 없음」으로 보아 앞 이슈의 안내가 한 번 보이는 것을 막는다(WP-2095 반려 5).
  const [conflictState, setConflictState] = useState<{ scope: string | undefined; map: Partial<Record<F, FieldConflict>> }>({
    scope,
    map: {},
  });
  const conflicts: Partial<Record<F, FieldConflict>> = conflictState.scope === scope ? conflictState.map : {};
  // 내 저장이 만든 version 모음 — 상세가 그 version 으로 바뀌어도 「다른 사람이 바꿨다」고 알리지 않기 위함.
  const saved = useRef<Map<number, SavedFields>>(new Map());

  // 이슈가 바뀌면 이전 이슈의 상태를 비운다 — 첫 렌더는 건너뛴다(처음 값은 바뀐 게 아니다).
  const seenScope = useRef(scope);
  useEffect(() => {
    if (seenScope.current === scope) return;
    seenScope.current = scope;
    bases.current = {};
    starts.current = {};
    saved.current = new Map();
    conflictsRef.current = {};
    setConflictState({ scope, map: {} });
  }, [scope]);

  const writeConflicts = (next: Partial<Record<F, FieldConflict>>) => {
    conflictsRef.current = next;
    setConflictState({ scope, map: next });
  };
  const setConflict = (field: F, value: FieldConflict | undefined) => {
    const next = { ...conflictsRef.current };
    if (value) next[field] = value;
    else delete next[field];
    writeConflicts(next);
  };

  // 이 훅이 판정하지 않는 실패(최신 조회 실패·다른 속성 409 등)는 일반 실패 토스트로 알린다 — quietConflict 로 훅의 토스트가 꺼져 있으므로 여기서 띄운다.
  const notifyFailure = (e: unknown) => handleApiError(e, '변경에 실패했습니다');

  /** 이 저장이 건드리는 필드. */
  const fieldsOf = (changes: UpdateIssueRequest): F[] =>
    FIELD_KEYS.filter((k) => changes[k] !== undefined) as F[];

  const endEdit = (field: F) => {
    delete bases.current[field];
    delete starts.current[field];
    if (conflictsRef.current[field]) setConflict(field, undefined);
  };

  /**
   * 저장 한 번 — retried 는 409 뒤 자동 재저장 중인지(재저장이 또 409 면 다시 재저장하지 않는다).
   * savedFrom — 이 요청이 기준으로 삼은 version. 첫 저장은 화면이 보던 version, 자동 재저장은 409 뒤 받아 온 최신 version 이다.
   * 왜 따로 받나: 재저장도 처음 클로저의 currentVersion 을 쓰면, 성공 뒤 「옛 version 기준인 다른 편집 필드」까지 새 version 으로 옮겨
   * 그 사이 다른 사람이 바꾼 그 필드를 다음 저장이 조용히 덮어쓴다(코드 리뷰 지적).
   */
  const attempt = async (
    changes: UpdateIssueRequest,
    retried: boolean,
    savedFrom: number | undefined = currentVersion,
  ): Promise<boolean> => {
    const fields = fieldsOf(changes);
    try {
      const updated = await update.mutateAsync(changes);
      // 내 저장으로 오른 version 은 충돌이 아니다 — 저장 직전 최신이던 편집 기준을 함께 올려, 본문을 쓰는 중에 상태만 바꾼 뒤
      // 본문을 저장해도 스스로와 충돌하지 않게 한다(그 사이 다른 사람의 변경이 있었다면 기준이 이미 달라 그대로 409).
      // 응답에 version 이 없으면(구버전 응답·스텁) 기록하지 않는다.
      const savedVersion = updated?.summary?.version;
      if (savedVersion !== undefined) {
        saved.current.set(savedVersion, Object.fromEntries(fields.map((f) => [f, changes[f]])) as SavedFields);
        // 저장마다 본문 값이 쌓이지 않게 최근 것만 남긴다(Map 은 넣은 순서 유지 — 맨 앞이 가장 오래된 것).
        if (saved.current.size > MAX_SAVED_VERSIONS) saved.current.delete(saved.current.keys().next().value as number);
      }
      const map = bases.current;
      for (const field of Object.keys(map) as F[]) {
        if (map[field] !== undefined && map[field] === savedFrom) map[field] = updated.summary.version;
      }
      // 저장한 필드는 편집이 끝난 것 — 기준·시작 값·충돌을 푼다.
      for (const field of fields) endEdit(field);
      return true;
    } catch (e) {
      // 409 가 아닌 실패(500·네트워크)는 서버 version 이 그대로라 기준을 지킨다 — 풀면 다시 저장할 때 version 없이 보내 그 사이 다른 변경을 덮어쓴다.
      // 버전 충돌이 아닌 409(STATUS_DELETED 등 코드가 붙은 것)도 여기서 걸러 판정·재조회로 보내지 않는다 — 토스트는 useUpdateIssue 가 띄운다.
      if (!isVersionConflictError(e)) return false;
      // 시작 값이 있는 필드만 판정한다(beginEdit 없이 저장한 필드는 기준 없이 둔다).
      const tracked = fields.filter((f) => starts.current[f] !== undefined);
      if (tracked.length === 0) {
        // 이 훅이 다루지 않는 409(상태·우선순위 등) — quietConflict 로 토스트가 꺼져 있으므로 여기서 알린다.
        notifyFailure(e);
        return false;
      }
      let latest: LatestValues<F>;
      try {
        latest = await fetchLatest();
      } catch {
        // 최신 상세를 못 받으면 판정할 수 없다 — 기준은 그대로 두고 실패로 돌려준다.
        notifyFailure(e);
        return false;
      }
      // 남이 실제로 바꾼 필드 — 자동 재저장이 또 409 여도 값을 비교해 실제로 바뀐 필드만 충돌로 둔다(값이 같은 필드를 충돌로 띄우면 헛안내).
      const changed = tracked.filter((f) => latest.values[f] !== starts.current[f]);
      if (changed.length > 0) {
        const next = { ...conflictsRef.current };
        for (const f of changed) next[f] = { latest: latest.values[f], latestVersion: latest.version };
        writeConflicts(next);
        return false;
      }
      // 바뀐 필드가 없다 — 다른 속성만 바뀐 것이다.
      if (retried) {
        // 자동 재저장 중 또 다른 속성만 바뀌었다 — 되풀이하지 않고(재저장은 한 번뿐) 일반 실패로 알린다. 기준은 방금 옮긴 최신 version 이라
        // 사용자가 다시 저장하면 그때 다시 판정한다.
        notifyFailure(e);
        return false;
      }
      // 최신 version 으로 기준을 옮겨 한 번만 자동 재저장한다. 이 저장이 건드리지 않는 다른 편집 중 필드도 최신 값이 시작 값과 같으면
      // (그 필드는 아무도 안 바꿨다) 함께 옮긴다 — 재저장 성공 뒤 savedFrom(=최신 version) 기준인 필드만 새 version 으로 따라 오르므로,
      // 최신 값이 달라진 필드는 옛 기준에 남아 다음 저장이 409 로 충돌을 알게 된다.
      for (const f of tracked) bases.current[f] = latest.version;
      for (const f of Object.keys(starts.current) as F[]) {
        if (tracked.includes(f) || bases.current[f] === undefined || conflictsRef.current[f]) continue;
        if (latest.values[f] === starts.current[f]) bases.current[f] = latest.version;
      }
      return attempt({ ...changes, version: latest.version }, true, latest.version);
    }
  };

  // 「최신으로 다시 쓰기」 — 기준·시작 값을 최신으로 옮기고 충돌을 지운 뒤 최신 값을 돌려준다(충돌이 없으면 null). overwrite 도 같은 이동을 쓴다.
  const takeLatest = (field: F): string | null => {
    const c = conflictsRef.current[field];
    if (!c) return null;
    bases.current[field] = c.latestVersion;
    starts.current[field] = c.latest;
    setConflict(field, undefined);
    return c.latest;
  };

  return {
    patch: (changes) => attempt(changes, false),
    beginEdit: (field, value) => {
      bases.current[field] = currentVersion;
      starts.current[field] = value;
      if (conflictsRef.current[field]) setConflict(field, undefined);
    },
    endEdit,
    baseVersion: (field) => bases.current[field],
    conflict: (field) => conflicts[field] ?? null,
    overwrite: (field) => {
      // 사용자는 안내에서 이 최신 값을 봤다 — 그 version·값을 새 기준으로 삼아, 이후 또 바뀐 경우에만 다시 충돌한다(최신으로 옮기는 동작은 takeLatest 와 같다).
      takeLatest(field);
    },
    takeLatest,
    reopenConflict: (field, latest) => {
      // 기준이 없으면(호출 순서가 어긋난 경우) 지금 보는 version 을 쓴다.
      const latestVersion = bases.current[field] ?? currentVersion ?? 0;
      setConflict(field, { latest, latestVersion });
    },
    savedVersions: () => saved.current,
    changedWhileEditing: (field, current, version) => {
      const base = bases.current[field];
      // 이슈가 바뀐 첫 렌더(effect 초기화 전)에는 앞 이슈의 기준·시작 값이 남아 있으니 판정하지 않는다.
      if (conflictState.scope !== scope) return false;
      return (
        base !== undefined &&
        starts.current[field] !== undefined &&
        !conflicts[field] &&
        version !== undefined &&
        version > base &&
        current !== starts.current[field]
      );
    },
  };
}
