// 프로젝트 설정 「리포트」 주간 리포트 줄(WP-1483) — 설정 조회·저장·템플릿 되돌리기·지금 생성(WP-1630) 훅.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchProjectReportSettings,
  generateProjectReport,
  resetProjectReportTemplate,
  updateProjectReportSettings,
} from '../../api/projectReports'
import type { ProjectReportSettings, UpdateProjectReportSettingsRequest } from '../../types/projectReport'
import { projectReportsKey } from './useProjectReports'
import { wikiKeys } from './wikiKeys'

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

/**
 * 「지금 생성」(WP-1630) — 서버가 노트 페이지를 만들거나 새 판을 쓰므로, 개요 카드 리포트 줄·노트 트리·그 페이지 본문·수정 기록 캐시를 무효화한다
 * (방금 만든 링크를 따라가거나 「리포트」를 열 때 옛 캐시가 보이지 않게). 트리는 어느 공간인지 응답에 없어 모든 공간 트리를 무효화한다.
 */
export function useGenerateProjectReport(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => generateProjectReport(projectKey),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: projectReportsKey(projectKey) })
      void qc.invalidateQueries({ queryKey: wikiKeys.trees() })
      void qc.invalidateQueries({ queryKey: wikiKeys.page(result.pageId) })
      void qc.invalidateQueries({ queryKey: wikiKeys.revisions(result.pageId) })
    },
  })
}
