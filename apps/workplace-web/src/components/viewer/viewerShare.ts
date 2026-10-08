// Web Share 로 파일 공유(WP-278, 스펙 §5.4). 판정은 viewerActions(순수), 여기는 브라우저 API 호출만.
import { toast } from 'sonner'

/** 파일 공유 API 가 있는가(share + canShare). 데스크톱 Firefox 등은 없다. */
export function canShareApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
}

/** 이 파일을 공유할 수 있는가 — 플랫폼이 형식을 거부하면(Android 의 docx·xlsx 등) 거짓. 예외는 거짓으로. */
export function canShareFile(file: File): boolean {
  try {
    return canShareApi() && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * 공유 시트를 연다. 반드시 사용자 제스처(클릭) 핸들러 안에서 await 없이 바로 부른다 — await 뒤 호출은 NotAllowedError.
 * 사용자가 시트를 닫은 취소(AbortError)는 정상 흐름이라 조용히 끝낸다.
 */
export async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] })
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return
    toast.error('공유하지 못했습니다')
  }
}
