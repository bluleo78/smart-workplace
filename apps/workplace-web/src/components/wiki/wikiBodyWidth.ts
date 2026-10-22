import { pageReadingWidthClass } from '@/components/layout/Page'
import { cn } from '@/lib/utils'

/**
 * 노트 본문 칼럼 폭(WP-793) — 기본은 읽기 폭(768px)을 가운데에 두고, 「전체 폭」 페이지는 제한 없이 스크롤 영역 끝까지 쓴다.
 * 노트만 가운데 정렬이다(디자인 시스템 「mx-auto 금지」의 예외 — 넓은 화면에서 오른쪽만 크게 비지 않게, Notion·Confluence 와 같은 배치).
 * 에디터 본문·버전 미리보기·동기화 안내 띠·로딩 skeleton·공개 공유 화면이 같은 칼럼을 쓴다.
 */
export const wikiBodyColumnClass = (fullWidth = false) => (fullWidth ? undefined : readingColumnClass)

const readingColumnClass = cn('mx-auto w-full', pageReadingWidthClass)
