// 편집 기준 version 을 지키는 이슈 필드 저장(#611) — 팀 이슈 상세(제목·본문)와 개인 작업 상세(메모)가 함께 쓴다(WP-1374).
// 왜: 제목·본문은 편집을 시작한 순간의 version 을 저장 기준으로 고정해야, 편집하는 사이 코멘트 SSE·창 포커스 리페치로 캐시 version 이
// 올라가도 그 사이 다른 사람(AI 포함)이 바꾼 내용을 모른 채 덮어쓰지 않고 409 로 알 수 있다. 그 기준을 올리고 푸는 규칙을 한 곳에 둔다.
import { useRef } from 'react';

import { isConflictError } from '@/lib/api-error';
import type { IssueDetailResponse, UpdateIssueRequest } from '@/types/issue';

/** 저장 mutation 의 필요한 부분만 — useUpdateIssue 결과를 그대로 넘긴다. */
interface UpdateMutation {
  mutateAsync: (changes: UpdateIssueRequest) => Promise<IssueDetailResponse>;
}

export interface VersionedPatch<F extends string> {
  /** 필드 저장 — 성공 여부를 돌려준다(편집기가 실패 시 입력을 버리지 않고 편집을 다시 연다). */
  patch: (changes: UpdateIssueRequest) => Promise<boolean>;
  /** 편집 진입 — 지금 보고 있는 version 을 이 필드의 저장 기준으로 고정한다. */
  beginEdit: (field: F) => void;
  /** 이 필드의 저장 기준 version — 저장 요청의 version 으로 싣는다. 기준이 없으면 undefined(useUpdateIssue 가 캐시 version 을 쓴다). */
  baseVersion: (field: F) => number | undefined;
}

/**
 * update — useUpdateIssue 결과. currentVersion — 지금 화면이 보고 있는 이슈 version(로드 전이면 undefined).
 * 실패 안내(409 포함)는 useUpdateIssue 가 띄우므로 여기선 기준 version 만 다룬다.
 */
export function useVersionedPatch<F extends string>(
  update: UpdateMutation,
  currentVersion: number | undefined,
): VersionedPatch<F> {
  // 필드별 편집 기준 version — 렌더에 쓰지 않으므로 ref(바뀌어도 다시 그리지 않는다).
  const bases = useRef<Partial<Record<F, number>>>({});

  const patch = async (changes: UpdateIssueRequest): Promise<boolean> => {
    const savedFrom = currentVersion;
    try {
      const updated = await update.mutateAsync(changes);
      // 내 저장으로 오른 version 은 충돌이 아니다 — 저장 직전 최신이던 편집 기준을 함께 올려, 본문을 쓰는 중에 상태만 바꾼 뒤
      // 본문을 저장해도 스스로와 충돌하지 않게 한다(그 사이 다른 사람의 변경이 있었다면 기준이 이미 달라 그대로 409).
      const map = bases.current;
      for (const field of Object.keys(map) as F[]) {
        if (map[field] !== undefined && map[field] === savedFrom) map[field] = updated.summary.version;
      }
      return true;
    } catch (e) {
      // 409 면 최신 이슈를 다시 불러오므로 기준을 모두 풀어 다음 저장이 새 version 을 쓰게 한다.
      // 그 밖의 실패(500·네트워크)는 서버 version 이 그대로라 기준을 지킨다 — 풀면 다시 저장할 때 version 없이 보내 그 사이 다른 변경을 덮어쓴다.
      if (isConflictError(e)) bases.current = {};
      return false;
    }
  };

  return {
    patch,
    beginEdit: (field) => {
      bases.current[field] = currentVersion;
    },
    baseVersion: (field) => bases.current[field],
  };
}
