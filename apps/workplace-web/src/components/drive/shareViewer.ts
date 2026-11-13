// 공유 링크로 여는 뷰어 출처·항목(WP-1227 → WP-1539 에서 공유 화면 밖으로 꺼냄).
// 공유 화면(/s/:token)과 「공유받은 항목」 목록이 같은 규칙으로 파일을 연다 — 원본·변환 PDF·다운로드를 공개 공유 경로로 받아,
// 매 요청 링크 가드(폐기·만료·사내·비밀번호 열람 토큰)를 서버가 다시 거친다. 목록 행은 권한을 주지 않는다.

import {
  downloadShare,
  fetchShareBlob,
  fetchShareConverted,
  type ShareFileInfo,
  sharePublicBase,
  SharePublicError,
} from '@/api/drivePublicShare'
import type { ViewerItem, ViewerItemSource } from '@/components/viewer/types'

/** 응답 상태 — SharePublicError 가 아니면(네트워크 등) 0. */
export function shareErrorStatus(e: unknown): number {
  return e instanceof SharePublicError ? e.status : 0
}

/**
 * 공유 링크 뷰어 출처 — 원본·변환 PDF·다운로드를 공개 경로 + 열람 토큰으로 받는다.
 * 401(열람 토큰 만료·로그인 풀림)이면 onUnauthorized 로 알린 뒤 실패를 그대로 넘긴다(뷰어는 오류 화면).
 */
export function shareViewerSource(token: string, viewToken: string | null, onUnauthorized: () => void): ViewerItemSource {
  const guard = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (e) {
      if (shareErrorStatus(e) === 401) onUnauthorized()
      throw e
    }
  }
  return {
    fetchBlob: (path, opts) => guard(() => fetchShareBlob(path, viewToken, opts)),
    fetchConverted: (path, signal) => guard(() => fetchShareConverted(path, viewToken, signal)),
    download: (item) => guard(() => downloadShare(token, viewToken, item.name)),
  }
}

/** 공유 링크 파일 한 개의 뷰어 항목 — 요약·참조된 곳·가져오기·드라이브에서 열기 같은 부가 필드는 두지 않는다(링크로 받은 파일). */
export function shareViewerItem(token: string, file: Pick<ShareFileInfo, 'name' | 'mimeType' | 'sizeBytes'>, source: ViewerItemSource): ViewerItem {
  const base = sharePublicBase(token)
  return {
    key: `share:${token}`,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    contentPath: `${base}/content`,
    downloadPath: `${base}/download`,
    previewPath: `${base}/preview`,
    source,
  }
}
