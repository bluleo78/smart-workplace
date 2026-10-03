// 이슈 본문 이미지 API(WP-199). 업로드 응답의 url 을 본문 마크다운에 그대로 넣는다 —
// 백엔드 IssueBodyImageResponse.urlOf 와 짝(형식을 바꾸면 양쪽을 함께).
import { client } from './client'

export type IssueImageUpload = {
  fileId: number
  url: string
  name: string
  mimeType: string
  size: number
}

export async function uploadIssueImage(projectKey: string, file: File): Promise<IssueImageUpload> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<IssueImageUpload>(
    `/projects/${projectKey}/issue-images`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }, // 기본 JSON 헤더를 multipart 로 덮어쓴다(boundary 는 axios 가 채움)
  )
  return data
}

/** 본문 img src 가 이 프로젝트의 이슈 이미지 경로인지 — 렌더러가 인증 blob 으로 받을 대상만 고른다. */
export function issueImagePathPattern(projectKey: string): RegExp {
  const escaped = projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^/api/v1/projects/${escaped}/issue-images/\\d+$`)
}
