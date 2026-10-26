// 버전 행·상세가 같이 쓰는 한 번에 끝나는 동작(WP-888) — 출시 취소·보관·복원. 결과는 토스트로 알리고 실패는 서버 문구를 보인다.
// (편집·출시·삭제는 입력이 필요해 각자 대화상자가 맡는다.)
import { toast } from 'sonner';

import { useUnreleaseVersion, useUpdateVersion } from '../../../hooks/queries/useVersions';
import { handleApiError } from '../../../lib/api-error';
import type { VersionResponse } from '../../../types/version';

export function useVersionActions(projectKey: string) {
  const update = useUpdateVersion(projectKey);
  const unrelease = useUnreleaseVersion(projectKey);

  function setArchived(v: VersionResponse, archived: boolean) {
    update.mutate(
      { id: v.id, body: { archived } },
      {
        onSuccess: () => toast.success(archived ? '버전을 보관했어요' : '버전을 복원했어요'),
        onError: (e) => handleApiError(e, archived ? '보관하지 못했습니다' : '복원하지 못했습니다'),
      },
    );
  }

  function cancelRelease(v: VersionResponse) {
    unrelease.mutate(v.id, {
      onSuccess: () => toast.success('출시를 취소했어요'),
      onError: (e) => handleApiError(e, '출시를 취소하지 못했습니다'),
    });
  }

  return { archive: (v: VersionResponse) => setArchived(v, true), restore: (v: VersionResponse) => setArchived(v, false), cancelRelease };
}
