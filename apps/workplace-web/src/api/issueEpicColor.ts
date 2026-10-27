// 에픽 색 바꾸기 API(WP-1017) — 보고자처럼 별도 PUT 엔드포인트.

import type { ColorToken } from '../types/label';
import { client } from './client';

/** 에픽 색을 colorToken 으로 바꾼다. 응답은 저장된 토큰. 에픽이 아니거나 허용되지 않은 토큰이면 서버가 400. */
export async function changeEpicColor(
  projectKey: string,
  number: number,
  colorToken: ColorToken,
): Promise<{ colorToken: ColorToken }> {
  const { data } = await client.put<{ colorToken: ColorToken }>(`/projects/${projectKey}/issues/${number}/epic-color`, {
    colorToken,
  });
  return data;
}
