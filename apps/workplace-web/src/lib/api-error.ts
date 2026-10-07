import axios from 'axios';
import { toast } from 'sonner';

import type { ErrorResponse } from '@/types/auth';

/**
 * ErrorResponse에서 사용자에게 표시할 메시지를 추출한다.
 * errors 필드(필드별 검증 오류)가 있으면 첫 번째 값을 우선 반환하여
 * 한국어 검증 메시지가 그대로 토스트에 뜨도록 한다.
 * errors 없으면 최상위 message, 그것도 없으면 fallback 사용.
 */
function pickBestMessage(errData: ErrorResponse, fallback: string): string {
  if (errData.errors) {
    const firstFieldMsg = Object.values(errData.errors)[0];
    if (firstFieldMsg) return firstFieldMsg;
  }
  return errData.message || fallback;
}

/**
 * Axios 에러에서 백엔드 ErrorResponse.message를 추출한다.
 * responseType: 'blob' 요청에서 서버가 에러를 반환하면 error.response.data가
 * Blob 형태로 오므로, 이를 텍스트로 읽어 JSON 파싱을 시도한다.
 */
export function extractApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data;
    // responseType: 'blob' 요청의 에러 응답은 Blob 형태로 전달된다
    if (data instanceof Blob) {
      // 동기 콘텍스트에서는 fallback 반환 — 비동기 변환은 extractApiErrorAsync 사용
      return fallback;
    }
    const errData = data as ErrorResponse;
    return pickBestMessage(errData, fallback);
  }
  return fallback;
}

/**
 * Blob 응답 타입을 포함한 비동기 에러 메시지 추출.
 * responseType: 'blob' API 호출의 catch 블록에서 사용한다.
 */
export async function extractApiErrorAsync(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text) as ErrorResponse;
        return pickBestMessage(parsed, fallback);
      } catch {
        return fallback;
      }
    }
    const errData = data as ErrorResponse;
    return pickBestMessage(errData, fallback);
  }
  return fallback;
}

export function handleApiError(error: unknown, fallback: string): void {
  toast.error(extractApiError(error, fallback));
}

/**
 * Blob responseType 요청의 에러를 처리하고 토스트로 표시한다.
 */
export async function handleApiErrorAsync(
  error: unknown,
  fallback: string,
): Promise<void> {
  const message = await extractApiErrorAsync(error, fallback);
  toast.error(message);
}

/**
 * 조회 에러가 HTTP 404(대상 삭제됨) 인지 판별한다.
 * resource.changed(deleted) 로 열린 상세가 재조회에서 404 를 받아도 TanStack Query 는 마지막 성공 data 를
 * 유지하므로, 화면이 error 를 먼저 보고 stale data 대신 not-found 상태를 그리는 데 쓴다.
 */
/**
 * 다시 보내도 결과가 같은 실패 상태인가 — 4xx(요청 시간 초과 408·요청 과다 429 제외). 네트워크 오류(상태 없음)·5xx 는 일시 실패.
 * 토큰 갱신 거절(로그인 상실) 판정과 노트 제목 저장 재시도 포기가 같은 규칙을 쓴다.
 */
export function isPermanentClientStatus(status: number | undefined): boolean {
  return status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function isNotFoundError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}
