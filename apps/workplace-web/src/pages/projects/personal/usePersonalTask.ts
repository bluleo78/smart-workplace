// 개인 작업 단건 상태(WP-221) — 데스크톱 패널/모달(PersonalTaskDetail)과 모바일 전체 화면(PersonalTaskMobile)이 공유한다.
// 조회·수정 mutation·원격 삭제(404) 판정·AI 화면 컨텍스트 등록을 한 곳에 둬 두 화면이 어긋나지 않게 한다.
import { useMemo } from 'react';

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext';
import { useIssue, useUpdateIssue } from '@/hooks/queries/useIssue';
import { buildIssueDetailContext } from '@/lib/aiScreenContext/builders/issue';
import { isNotFoundError } from '@/lib/api-error';

export function usePersonalTask(projectKey: string, number: number) {
  const q = useIssue(projectKey, number);
  const update = useUpdateIssue(projectKey, number);
  // 원격 삭제 후 재조회 404 — stale q.data 가 남아도 필드/제목을 숨기고 not-found 만 보여준다.
  const gone = isNotFoundError(q.error);
  const data = gone ? undefined : q.data;
  // WP-54: 열린 개인 태스크를 AI 화면 컨텍스트 대상(focus)으로 등록 — 범위는 '개인 프로젝트'로 덮어쓴다.
  // 화면이 닫혀 언마운트되거나 이슈가 없으면(로딩·404) 해제된다.
  const screenContext = useMemo(
    () =>
      data
        ? { ...buildIssueDetailContext({ projectKey, issue: data.summary }), scope: { label: '개인 프로젝트', refs: { projectKey } } }
        : null,
    [data, projectKey],
  );
  useRegisterAiScreenContext(screenContext);
  return { q, update, data };
}
