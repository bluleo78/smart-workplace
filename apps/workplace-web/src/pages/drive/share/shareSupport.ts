// 공유 링크 화면(/s/:token) 공용 도우미 — 파일 카드(ShareLinkPage)와 폴더 보기(FolderShareView)가 함께 쓴다(WP-1538).
// 오류 상태 판독·안내 문구·뷰어 출처를 한곳에 두어 파일·폴더 화면의 안내가 갈라지지 않게 한다.

// 상태 판독·뷰어 출처는 「공유받은 항목」(WP-1539)과 함께 쓰는 components/drive/shareViewer 한 벌을 그대로 내보낸다 — 규칙이 갈라지지 않게.
export { shareViewerSource, shareErrorStatus as statusOf } from '@/components/drive/shareViewer'

/** ?folder= 값 → 폴더 id. 양의 정수가 아니면(없음·문자·음수) null = 공유 폴더(WP-1538 판정: 잘못된 값은 루트로). */
export function parseFolderParam(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 잠김(시도 초과·IP 제한) 안내 — 비밀번호 칸 아래와 다운로드 실패에 같이 쓴다. 서버는 429(이전 계약 423 도 같이 본다). */
export const LOCKED_MESSAGE = '시도 횟수를 넘었습니다. 잠시 뒤 다시 시도하세요'

/** 잠김 응답인가 — 429(지금 계약)·423(이전 계약). */
export function isLocked(status: number): boolean {
  return status === 429 || status === 423
}

/** 정보 조회 실패 → 원인 안내(막다른 화면이 되지 않게 다음 행동은 errorAction). */
export function infoErrorMessage(status: number): string {
  if (status === 410) return '만료되었거나 폐기된 링크입니다.'
  if (status === 404) return '존재하지 않는 링크입니다.'
  // WP-1538: 다른 워크스페이스 403 은 정보 오류로 와서 대상 종류를 모른다 — 폴더 링크도 이 문구를 그대로 쓴다.
  if (status === 403) return '이 워크스페이스 사람만 볼 수 있는 파일입니다. 다른 워크스페이스 계정이 있다면 전환한 뒤 다시 여세요.'
  return '링크를 열지 못했습니다. 잠시 후 다시 시도하세요.'
}

/** 다운로드 실패 안내 — 401 은 잠금 카드로 돌아가므로 여기 오지 않는다. */
export function downloadErrorMessage(status: number): string {
  if (isLocked(status)) return LOCKED_MESSAGE
  if (status === 410 || status === 404) return infoErrorMessage(status)
  return '다운로드에 실패했습니다. 잠시 후 다시 시도하세요.'
}
