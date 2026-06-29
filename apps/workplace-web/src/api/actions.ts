// 공용 cross-app 확인 액션 — actionType 으로 라우팅하는 중립 엔드포인트.
import { client } from './client'

export interface ConfirmActionArgs {
  actionType: string
  params: Record<string, unknown>
}

/** 확인 카드 승인 — 201 + 결과 객체(actionType 별). */
export const confirmAction = <T = unknown>(args: ConfirmActionArgs) =>
  client.post<T>('/actions/confirm', args).then((r) => r.data)
