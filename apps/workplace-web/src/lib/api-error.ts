import axios from 'axios';
import { toast } from 'sonner';

import type { ErrorResponse } from '@/types/auth';

/** 도메인 오류 코드 모양(AI_DISABLED·AI_MEMORY_FULL 등) — 필드 검증 문구(한국어 문장)와 구분한다. */
const DOMAIN_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * ErrorResponse에서 사용자에게 표시할 메시지를 추출한다.
 * errors 필드(필드별 검증 오류)가 있으면 첫 번째 값을 우선 반환하여
 * 한국어 검증 메시지가 그대로 토스트에 뜨도록 한다.
 * 단 errors 가 도메인 오류 코드(errors.code — 예: AI_DISABLED)를 싣고 있으면 그 코드 문자열 대신 message 를 쓴다.
 * errors 없으면 최상위 message, 그것도 없으면 fallback 사용.
 */
function pickBestMessage(errData: ErrorResponse, fallback: string): string {
  const code = errData.errors?.code;
  if (errData.errors && !(typeof code === 'string' && DOMAIN_ERROR_CODE.test(code))) {
    const firstFieldMsg = Object.values(errData.errors)[0];
    if (firstFieldMsg) return firstFieldMsg;
  }
  return errData.message || fallback;
}

/**
 * Axios 에러의 백엔드 ErrorResponse 본문 — Axios 에러가 아니거나 본문이 없으면 null.
 * responseType: 'blob' 요청의 에러 응답은 Blob 형태로 오는데, 동기 콘텍스트에서는 읽을 수 없어 null 이다(비동기 변환은 extractApiErrorAsync).
 */
export function apiErrorResponse(error: unknown): ErrorResponse | null {
  if (!axios.isAxiosError(error) || !error.response?.data) return null;
  const data = error.response.data;
  return data instanceof Blob ? null : (data as ErrorResponse);
}

/**
 * Axios 에러에서 백엔드 ErrorResponse.message를 추출한다.
 * responseType: 'blob' 요청에서 서버가 에러를 반환하면 error.response.data가
 * Blob 형태로 오므로, 이를 텍스트로 읽어 JSON 파싱을 시도한다.
 */
export function extractApiError(error: unknown, fallback: string): string {
  const errData = apiErrorResponse(error);
  if (errData) return pickBestMessage(errData, fallback);
  return isNetworkError(error) ? `${fallback}. ${NETWORK_ERROR_HINT}` : fallback;
}

/** 서버에 닿지 못한 실패(오프라인·연결 끊김)에 덧붙이는 안내 — 무엇이 실패했는지(fallback) 뒤에 붙인다(WP-927). */
export const NETWORK_ERROR_HINT = '네트워크 연결을 확인한 뒤 다시 시도하세요';

/**
 * 응답 없이 끝난 네트워크 오류(오프라인·연결 끊김 — Axios ERR_NETWORK)인가.
 * 사용자가 취소한 요청(ERR_CANCELED)·시간 초과(ECONNABORTED)는 연결 문제로 안내하지 않는다.
 */
export function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response && error.code === 'ERR_NETWORK';
}

/**
 * 백엔드 도메인 오류 코드(ErrorResponse.errors.code — 예: AI_MEMORY_FULL) — 없으면 null.
 * 문구 대신 코드로 분기해야 하는 화면(메모리 되돌리기 토스트 등)이 쓴다.
 */
export function extractApiErrorCode(error: unknown): string | null {
  const code = apiErrorResponse(error)?.errors?.code;
  return typeof code === 'string' ? code : null;
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

/** 조회 오류의 HTTP 상태 — Axios 응답이 없으면(네트워크 오류 등) undefined. */
export function apiErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
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

/**
 * 다시 시도하면 될 수 있는 요청 실패인가(WP-859) — 응답 없음(네트워크)·5xx·408·429. 요청 오류(Axios)가 아닌 예외(코드·데이터 결함)는
 * 다시 해도 같으므로 일시 실패로 보지 않는다. 앱을 열 때의 세션 확인이 「세션을 남기고 다시 시도」와 「로그아웃」을 가르는 데 쓴다.
 */
export function isTransientRequestError(error: unknown): boolean {
  return axios.isAxiosError(error) && !isPermanentClientStatus(error.response?.status);
}

export function isNotFoundError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/** HTTP 409(충돌 — 동시에 같은 이름이 생김·낙관적 잠금 등)인지 — 호출부가 상황에 맞는 문구로 바꿔 보일 때 쓴다. */
export function isConflictError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409;
}
