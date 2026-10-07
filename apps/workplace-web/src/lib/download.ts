// 브라우저 다운로드 트리거 — 메모리의 Blob 을 a[download] 로 저장시킨다.

/**
 * object URL 해제 지연(ms). iOS Safari·홈 화면 앱은 a[download] 클릭 직후 URL 을 해제하면
 * 저장이 실패하거나 빈 파일이 된다(스펙 §5.4). 1분이면 저장 시작에 충분하고 메모리도 곧 돌려받는다.
 */
export const REVOKE_DELAY_MS = 60_000

/** Blob 을 filename 으로 내려받게 한다. URL 해제는 REVOKE_DELAY_MS 뒤. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(filename, blob);
}
