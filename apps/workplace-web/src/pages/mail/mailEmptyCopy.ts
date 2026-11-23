// 메일 목록 빈 상태(testId `mail-list-empty`)의 제목·설명 문구(WP-1864 · 리뷰 후속).
//
// 왜 순수 함수인가 — 「새로고침 단추를 눌러보세요.」 반대쪽 갈래(동기화 단추가 없는 보기에 쓰는 문구)는
// 지금 렌더로 닿지 않는다. 2026-11-23 실측: 서버 메일함(`?box=N`)은 `mail-box-empty`, 별표 모아 보기는
// 검색하지 않을 때 `mail-flagged-empty`(검색하면 검색 문구로 이 빈 상태에 온다), 임시보관함은 MailDraftsPage 의
// `mail-drafts-empty` 를 그린다. 단추 없이 이 빈 상태에 오는 실제 보기는 보낸편지함뿐이고 그때는 보낸편지함
// 문구가 먼저 간다 — 남은 것은 아래 네 번째 return 이라 단위 테스트로 고정한다.
// 그래서 문구 결정을 여기로 빼어 갈래마다 단위 테스트(`mailEmptyCopy.test.ts`)로 고정하고,
// 실제로 닿는 보기는 렌더 테스트(받은편지함·보낸편지함)가 그대로 지킨다.
import type { MailFolder } from '../../types/mailMessage'

export interface MailListEmptyCopy {
  title: string
  description: string
}

/**
 * 목록이 비었을 때 그릴 제목·설명 — 검색·보낸편지함이 먼저이고, 그 밖에는 동기화 단추가 화면에 있는지에 따라 갈린다.
 * 단추가 없는 보기는 단추를 가리키지 않고(WP-1864 재반려 1) 제목도 그 보기에 맞춘다(WP-1864 리뷰 후속 ②).
 */
export function mailListEmptyCopy({
  search,
  folderParam,
  showSyncControls,
  viewTitle,
}: {
  /** 검색어 — 비어 있지 않으면 목록을 검색으로 좁힌 결과다 */
  search: string
  /** 고정 메일함 — 받은편지함(INBOX)·보낸편지함(SENT) */
  folderParam: MailFolder
  /** 목록 위 필터 줄에 동기화 단추를 그리고 있는가(MailInboxPage 의 showSyncControls) */
  showSyncControls: boolean
  /** 지금 보는 보기의 이름(MailView.title) — 단추가 없는 보기에 쓴다 */
  viewTitle: string
}): MailListEmptyCopy {
  if (search) return { title: '검색 결과가 없어요', description: '다른 검색어로 찾아보세요.' }
  if (folderParam === 'SENT') return { title: '보낸 메일이 없어요', description: '메일을 보내면 여기에 모여요.' }
  if (showSyncControls) return { title: '받은 메일이 없어요', description: '새로고침 단추를 눌러보세요.' }
  return { title: `${viewTitle} 메일이 없어요`, description: '이 보기에 보여 줄 메일이 없어요.' }
}
