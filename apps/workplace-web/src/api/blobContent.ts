import { client } from './client'

// axios client baseURL 이 '/api/v1' 이므로, '/api/v1/...' 절대 경로는 접두어를 제거해 중복 호출을 막는다.
// 앞부분에만 적용한다 — 경로 중간의 같은 문자열은 실제 경로 일부이므로 건드리면 안 된다.
export function stripApiPrefix(path: string): string {
  return path.replace(/^\/api\/v1/, '')
}

/** 임의 콘텐츠 경로(/api/v1/... 절대경로 가능)의 원본 Blob. 호출처가 objectURL/text() 로 변환. */
export async function fetchBlobByPath(path: string): Promise<Blob> {
  const { data } = await client.get<Blob>(stripApiPrefix(path), { responseType: 'blob' })
  return data
}

/**
 * 임의 콘텐츠 경로에서 blob object URL.
 * 액세스 토큰이 메모리 Bearer 라 <img>/<a> 가 헤더를 못 싣는다 — axios 로 받아 objectURL 로 바꾼다.
 * revoke 는 호출처 책임.
 */
export async function fetchBlobUrlByPath(path: string): Promise<string> {
  const blob = await fetchBlobByPath(path)
  return URL.createObjectURL(blob)
}

/** 임의 콘텐츠 경로의 텍스트 본문. */
export async function fetchTextByPath(path: string): Promise<string> {
  const blob = await fetchBlobByPath(path)
  return await blob.text()
}
