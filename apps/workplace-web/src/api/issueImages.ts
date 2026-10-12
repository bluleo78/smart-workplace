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

/**
 * 이슈 이미지 경로 정규식 원본 `/api/v1/projects/{키}/issue-images/{id}` — 백엔드 IssueBodyImageResponse.REF 와 짝. group(1)=프로젝트 키.
 * 코멘트 이미지 마크다운 파서(components/mentions/apiImageSegments)가 이 원본으로 패턴을 만든다.
 */
export const ISSUE_IMAGE_PATH_SOURCE = String.raw`/api/v1/projects/([^/\s)]+)/issue-images/\d{1,19}(?!\d)`
const ISSUE_IMAGE_PATH = new RegExp(`^${ISSUE_IMAGE_PATH_SOURCE}$`)

/** src 가 (어느 프로젝트든) 이슈 이미지 경로인지 — 입력창 이미지 노드가 인증 요청·붙여넣기 수용 대상을 고를 때. */
export function isIssueImageSrc(src: string | null | undefined): boolean {
  return src != null && ISSUE_IMAGE_PATH.test(src)
}

/**
 * 본문 img src 가 이 프로젝트의 이슈 이미지 경로면 fileId 를, 아니면 null 을 돌려준다 — 렌더러가 인증 blob 으로 받을 대상만 고른다.
 * 접두 비교 + 숫자 꼬리 검사라 렌더마다 정규식을 만들거나 키를 이스케이프할 필요가 없다.
 */
export function issueImageFileId(projectKey: string, src: string | undefined): number | null {
  const prefix = `/api/v1/projects/${projectKey}/issue-images/`
  if (!src?.startsWith(prefix)) return null
  const tail = src.slice(prefix.length)
  return /^\d+$/.test(tail) ? Number(tail) : null
}
