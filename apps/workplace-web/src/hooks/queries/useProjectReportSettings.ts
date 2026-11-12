// 프로젝트 설정 「리포트」 주간 리포트 줄(WP-1483) — 설정 조회·저장·템플릿 되돌리기 훅.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchProjectReportSettings,
  resetProjectReportTemplate,
  updateProjectReportSettings,
} from '../../api/projectReports'
import type { ProjectReportSettings, UpdateProjectReportSettingsRequest } from '../../types/projectReport'

/** 쿼리 키. */
export const projectReportSettingsKey = (projectKey: string) => ['projectReportSettings', projectKey] as const

/** 리포트 설정 조회. */
export function useProjectReportSettings(projectKey: string) {
  return useQuery({
    queryKey: projectReportSettingsKey(projectKey),
    queryFn: () => fetchProjectReportSettings(projectKey),
    enabled: !!projectKey,
  })
}

/**
 * 저장·되돌리기 응답을 그대로 설정 캐시에 넣는 onSuccess — 두 변경 훅이 같이 쓴다.
 * 다시 부르지 않고 응답을 쓰는 이유: PUT·POST 응답이 GET 과 같은 모양이라 재조회 동안 옛 값이 깜빡이지 않는다.
 */
function useWriteSettingsCache(projectKey: string) {
  const qc = useQueryClient()
  return (data: ProjectReportSettings) => {
    qc.setQueryData(projectReportSettingsKey(projectKey), data)
  }
}

/** 리포트 설정 저장 — 응답(다음 실행 시각·템플릿 페이지가 바뀜)을 그대로 캐시에 넣는다. */
export function useUpdateProjectReportSettings(projectKey: string) {
  const onSuccess = useWriteSettingsCache(projectKey)
  return useMutation({
    mutationFn: (body: UpdateProjectReportSettingsRequest) => updateProjectReportSettings(projectKey, body),
    onSuccess,
  })
}

/** 템플릿 되돌리기 — 템플릿이 새로 복사되면 페이지 id 가 바뀌므로 응답을 캐시에 넣는다. */
export function useResetProjectReportTemplate(projectKey: string) {
  const onSuccess = useWriteSettingsCache(projectKey)
  return useMutation({
    mutationFn: () => resetProjectReportTemplate(projectKey),
    onSuccess,
  })
}
