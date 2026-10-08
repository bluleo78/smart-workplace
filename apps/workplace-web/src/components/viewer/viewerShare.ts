// Web Share 로 파일 공유(WP-278, 스펙 §5.4). 판정은 viewerActions(순수), 여기는 브라우저 API 호출만.
import { toast } from 'sonner'

/** 파일 공유 API 가 있는가(share + canShare). 데스크톱 Firefox 등은 없다. */
function canShareApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
}

/**
 * 이 브라우저가 파일 공유를 지원하는가 — API 가 있어도 데스크톱 브라우저는 files 공유를 거부할 수 있어 시험 파일로 묻는다.
 * 거짓이면 공유 칸을 비운다(비활성 버튼은 고장처럼 보임). 형식별 거부(docx 등)는 canShareFile 로 따로 본다. 예외는 거짓으로.
 */
export function canShareFiles(): boolean {
  try {
    return canShareApi() && navigator.canShare({ files: [new File([''], 'probe.txt', { type: 'text/plain' })] })
  } catch {
    return false
  }
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
 * 조용히 끝내는 경우:
 * - AbortError — 사용자가 시트를 닫은 취소(정상 흐름).
 * - InvalidStateError — 시트가 이미 열린 채 ⤴/⬇ 를 다시 탭함. 먼저 연 시트가 그대로 동작하므로 실패가 아니다.
 *   (진행 중 플래그로 막지 않는 이유: share() 가 끝나지 않는 브라우저가 있으면 플래그가 영영 풀리지 않는다.)
 */
export async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] })
  } catch (e) {
    const name = (e as DOMException)?.name
    if (name === 'AbortError' || name === 'InvalidStateError') return
    toast.error('공유하지 못했습니다')
  }
}
