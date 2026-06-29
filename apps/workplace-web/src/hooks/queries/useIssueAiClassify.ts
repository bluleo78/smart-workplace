// 이슈 AI 분류 제안 mutation 훅 — useGenerateAiSummary 패턴 미러.
import { useMutation } from '@tanstack/react-query';

import { issuesApi } from '../../api/issues';

/**
 * 이슈 AI 분류 제안 요청 mutation 훅.
 * @param projectKey 프로젝트 키 — 엔드포인트 경로에 사용
 */
export function useIssueAiClassify(projectKey: string) {
  return useMutation({
    mutationFn: (req: { title: string; body: string }) =>
      issuesApi.aiClassify(projectKey, req).then((r) => r.data),
  });
}
