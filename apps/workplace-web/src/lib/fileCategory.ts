// mimeType → 미리보기/썸네일 category. 백엔드 FileCategoryMapper 규칙과 동일.
export function mimeToCategory(mimeType: string): 'IMAGE' | 'PDF' | 'TEXT' | 'OTHER' {
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.startsWith('text/')) return 'TEXT'
  return 'OTHER'
}
