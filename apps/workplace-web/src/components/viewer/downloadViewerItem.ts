import { toast } from 'sonner'

import { driveApi } from '../../api/drive'
import { downloadBlob } from '../../lib/download'
import type { ViewerItem } from './types'

/** 지금 받는 중인 다운로드 경로 — 연타·여러 버튼(헤더 ⬇·하단 저장·오류 화면)이 같은 파일을 겹쳐 받지 않게. */
const inFlight = new Set<string>()

/**
 * 뷰어 항목 원본을 내려받는다 — 헤더 ⬇·하단 저장 칸과 본문 오류·미지원·10MB 확인 화면의 다운로드가 같이 쓴다.
 * - 미리보기 blob 이 이미 메모리에 있고 다운로드 경로가 미리보기 경로와 같으면(감사 로그 경로가 따로 없는 메일·이슈 첨부 등)
 *   그 blob 을 그대로 저장한다 — 같은 파일을 다시 받지 않게. 드라이브는 /download(감사 로그)로 늘 다시 받는다.
 * - 받는 중이면 다시 누른 것은 무시하고, 실패하면 토스트로 알린다(조용히 실패·처리되지 않은 거부가 남지 않게).
 * (viewerItems.ts 는 순수 함수만 두므로 API 호출은 여기에 둔다.)
 */
export async function downloadViewerItem(item: ViewerItem, blob?: Blob | null): Promise<void> {
  if (blob && item.downloadPath === item.contentPath) {
    downloadBlob(item.name, blob)
    return
  }
  if (inFlight.has(item.downloadPath)) return
  inFlight.add(item.downloadPath)
  try {
    await driveApi.downloadByPath(item.downloadPath, item.name)
  } catch {
    toast.error('파일을 내려받지 못했습니다')
  } finally {
    inFlight.delete(item.downloadPath)
  }
}
