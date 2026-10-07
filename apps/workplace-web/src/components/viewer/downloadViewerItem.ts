import { driveApi } from '../../api/drive'
import type { ViewerItem } from './types'

/**
 * 뷰어 항목 원본을 내려받는다 — 헤더 다운로드 버튼과 본문 오류·미지원·10MB 확인 화면의 다운로드가 같이 쓴다.
 * 경로·이름만 있으면 되므로 미리보기 blob 을 다시 받지 않는다. (viewerItems.ts 는 순수 함수만 두므로 API 호출은 여기에 둔다.)
 */
export function downloadViewerItem(item: ViewerItem) {
  return driveApi.downloadByPath(item.downloadPath, item.name)
}
