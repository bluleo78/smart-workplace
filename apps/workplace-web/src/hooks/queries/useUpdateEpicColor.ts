// 에픽 색 변경 mutation(WP-1017) — 보고자 변경(useChangeIssueReporter)과 같은 모양.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { changeEpicColor } from '../../api/issueEpicColor';
import { handleApiError } from '../../lib/api-error';
import type { ColorToken } from '../../types/label';

// 에픽 색은 그 에픽 상세뿐 아니라 하위 이슈의 부모 칩·목록 묶음 머리·타임라인 막대·에픽 패널(모두 검색 목록 캐시)과
// AI 위임 작업 묶음 머리·내 이슈 목록에도 보이므로 함께 다시 받는다. 성공 토스트는 띄우지 않는다 — 고른 색이 바로 보인다.
export function useUpdateEpicColor(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (colorToken: ColorToken) => changeEpicColor(projectKey, number, colorToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      qc.invalidateQueries({ queryKey: ['ai-tasks'] });
      qc.invalidateQueries({ queryKey: ['me-issues'] });
    },
    onError: (e) => handleApiError(e, '에픽 색을 바꾸지 못했습니다'),
  });
}
