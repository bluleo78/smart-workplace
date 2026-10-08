import { toast } from 'sonner'

import { driveApi } from '../../api/drive'
import { downloadBlob } from '../../lib/download'
import type { ViewerItem } from './types'

/** 지금 받는 중인 다운로드 경로 — 연타·여러 버튼(헤더 ⬇·하단 저장·오류 화면)이 같은 파일을 겹쳐 받지 않게. */
const inFlight = new Set<string>()
/** 메모리 blob 저장 뒤 같은 파일 재저장을 막아 두는 시간(ms) — 연타 한 묶음을 한 번으로 본다. */
const MEMORY_SAVE_HOLD_MS = 1000

/**
 * 뷰어 항목 원본을 내려받는다 — 헤더 ⬇·하단 저장 칸과 본문 오류·미지원·10MB 확인 화면의 다운로드가 같이 쓴다.
 * - 미리보기 blob 이 이미 메모리에 있고 다운로드 경로가 미리보기 경로와 같으면(감사 로그 경로가 따로 없는 메일·이슈 첨부 등)
 *   그 blob 을 그대로 저장한다 — 같은 파일을 다시 받지 않게. 드라이브는 /download(감사 로그)로 늘 다시 받는다.
 * - 받는 중이면 다시 누른 것은 무시하고, 실패하면 토스트로 알린다(조용히 실패·처리되지 않은 거부가 남지 않게).
 * (viewerItems.ts 는 순수 함수만 두므로 API 호출은 여기에 둔다.)
 */
export async function downloadViewerItem(item: ViewerItem, blob?: Blob | null): Promise<void> {
  // 받는 중 확인을 메모리 blob 저장보다 먼저 한다 — 연타가 같은 파일을 여러 번 저장하지 않게.
  const key = item.downloadPath
  if (inFlight.has(key)) return
  inFlight.add(key)
  if (blob && key === item.contentPath) {
    // 메모리 저장은 동기라 바로 풀면 연타를 막지 못한다 — 잠깐 잡아 두어 한 번의 연타 묶음은 한 번만 저장한다.
    downloadBlob(item.name, blob)
    setTimeout(() => inFlight.delete(key), MEMORY_SAVE_HOLD_MS)
    return
  }
  try {
    await driveApi.downloadByPath(key, item.name)
  } catch {
    toast.error('파일을 내려받지 못했습니다')
  } finally {
    inFlight.delete(key)
  }
}
