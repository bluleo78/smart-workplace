import axios from 'axios'

import type { ErrorResponse } from '../types/platform'

/** 서버 오류 응답({message})의 메시지를 꺼낸다 — 409(상태 전이 불가 등)의 구체 사유를 토스트에 그대로 보여주기 위해. 없으면 undefined. */
export function serverMessage(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined
  const message = (error.response?.data as Partial<ErrorResponse> | undefined)?.message
  return typeof message === 'string' && message.trim() ? message : undefined
}
