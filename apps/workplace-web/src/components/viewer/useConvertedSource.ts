import { downloadViewerItem } from './downloadViewerItem'
import type { ViewerItem } from './types'
import { useConvertedPreview } from './useConvertedPreview'
import type { PreviewSource } from './usePreviewBlob'

/** 변환 출처는 원본을 받지 않으므로 10MB 확인이 없다. */
const noop = () => {}

/**
 * 서버 변환 PDF 를 뷰어 본문의 출처 모양(PreviewSource)으로 맞춘다(WP-431) — 본문이 원본 blob 출처와 같은 방식으로 그리게.
 * 원본은 받지 않으므로 10MB 확인·진행이 없고, 다운로드는 늘 원본이다(변환 PDF 를 원본 이름으로 저장하지 않게 메모리 blob 을 넘기지 않는다).
 * 대상 아님이 아닌 404(휴지통·권한·원본 유실)는 원본 받기 실패와 같은 오류 화면으로 보인다.
 */
export function useConvertedSource(item: ViewerItem, enabled: boolean): PreviewSource {
  const { state, retry } = useConvertedPreview(item, enabled && !item.unavailable)
  return {
    blob: state?.s === 'ready' ? state.blob : null,
    error: state?.s === 'error',
    progress: null,
    confirmSize: null,
    confirm: noop,
    download: () => downloadViewerItem(item, null),
    retry,
    isOriginal: false,
    failed: state?.s === 'failed' ? { code: state.code, transient: state.transient } : null,
    unsupported: state?.s === 'unsupported',
  }
}
