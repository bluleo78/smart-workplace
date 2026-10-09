import { expect, type Page } from '@playwright/test'

import type { WikiRevisionItem, WikiRevisionList } from '../../src/types/wiki'
import { envShot } from './collab'
import { solidPng } from './png'
import { KIM } from './presence'
import { mockWikiMentions } from './wiki-mock'

// 노트 버전 기록(WP-282) E2E 공용 데이터 — 데스크톱(pages/wiki/wiki-revisions)과 모바일(pages/mobile/wiki-revisions) spec 이 함께 쓴다.
// 날짜 묶음("오늘"·"어제")과 HH:mm 이 실행 시각에 흔들리지 않게 spec 은 시간대(Asia/Seoul)를 고정하고 시계를 REVISION_NOW 에서 시작한다.

export const REVISION_SPACE_ID = 1
export const REVISION_PAGE_ID = 282
export const REVISION_TITLE = '10월 1주차 스프린트 리뷰'
export const REVISION_NOW = new Date('2026-10-07T15:00:00+09:00')
export const revisionPagePath = `/wiki/spaces/${REVISION_SPACE_ID}/pages/${REVISION_PAGE_ID}`
const at = (iso: string) => new Date(iso).toISOString()

export const LEE = { id: 5, name: '이영희' }
export const PARK = { id: 3, name: '박민수' }
/** 긴 이름 — 목록 줄 말줄임 확인용. */
export const CHOI = { id: 6, name: '최수진 (플랫폼개발팀 · 백엔드 파트 리드)' }

/** 지금(라이브) 본문 = 맨 위 판(v6) 본문 — 맨 위 판을 라이브와 비교하면 처음엔 차이가 없다. */
export const REVISION_LIVE = [
  '## 결정 사항',
  '노트 동시 편집은 Yjs 로 간다.',
  '모바일 이슈 상세는 다음 사이클로 이월한다.',
  '배포 체크리스트에 인그레스 타임아웃을 추가한다.',
].join('\n\n')
/** v5 — v6 대비: "CRDT 없이 병합으로" 가 지워지고("Yjs" 로 바뀜) 마지막 문단이 더해졌다. */
const V5 = ['## 결정 사항', '노트 동시 편집은 CRDT 없이 병합으로 간다.', '모바일 이슈 상세는 다음 사이클로 이월한다.'].join('\n\n')
const V4 = ['## 결정 사항', '아직 정하지 않았다.'].join('\n\n')

/** 판별 본문(마크다운). */
export const REVISION_DETAILS: Record<number, string> = { 6: REVISION_LIVE, 5: V5, 4: V4, 3: '## 초안', 2: '처음 만든 노트' }

type Person = { id: number; name: string }

/** 목록 한 판 — AI 귀속이 있으면 AI, 복원 전이면 RESTORE, 아니면 SESSION 사유. */
function revItem(
  title: string,
  version: number,
  iso: string,
  editors: Person[],
  opts: { aiActor?: Person; restore?: boolean } = {},
): WikiRevisionItem {
  return {
    version,
    title,
    editedAt: at(iso),
    createdAt: at(iso),
    reason: opts.aiActor ? 'AI' : opts.restore ? 'RESTORE' : 'SESSION',
    editors,
    aiActor: opts.aiActor ?? null,
  }
}
const item = (version: number, iso: string, editors: Person[], opts?: { aiActor?: Person }) =>
  revItem(REVISION_TITLE, version, iso, editors, opts)

/** 목록 — 오늘(현재 버전·14:32 AI·14:05·11:20), 어제(17:48 긴 이름), 10월 5일(09:12). */
export const REVISION_LIST: WikiRevisionList = {
  current: { version: 7, editedAt: at('2026-10-07T14:50:00+09:00'), editors: [KIM, PARK, LEE] },
  items: [
    item(6, '2026-10-07T14:32:00+09:00', [LEE], { aiActor: LEE }),
    item(5, '2026-10-07T14:05:00+09:00', [KIM, PARK]),
    item(4, '2026-10-07T11:20:00+09:00', [LEE]),
    item(3, '2026-10-06T17:48:00+09:00', [CHOI]),
    item(2, '2026-10-05T09:12:00+09:00', [KIM]),
  ],
}

/** 시각 검증 스크린샷 — REVISION_SHOTS(절대 경로)가 있을 때만 남긴다(평소 회귀 실행에선 아무것도 안 함). */
export function revisionShot(p: Page, name: string): Promise<void> {
  return envShot(p, 'REVISION_SHOTS', name)
}

// ── 공용 로케이터(데스크톱·모바일 spec) ─────────────────────────────────────────────

/** 읽기 전용 미리보기(데스크톱 덮개·모바일 전체화면 공통). */
export const revisionPreview = (p: Page) => p.getByTestId('wiki-revision-preview')
/** 목록 한 줄 — 판 번호 또는 'current'(현재 버전). */
export const revisionItem = (p: Page, v: number | 'current') => p.getByTestId(`wiki-revision-item-${v}`)

/** 헤더 ⋯ → 버전 기록. 데스크톱은 클릭 → 오른쪽 패널, 모바일(mobile)은 탭 → 전체화면 목록이 보일 때까지. */
export async function openRevisionHistory(p: Page, { mobile = false }: { mobile?: boolean } = {}) {
  const menu = p.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' })
  const history = p.getByTestId('wiki-menu-history')
  if (mobile) {
    await menu.tap()
    await history.tap()
  } else {
    await menu.click()
    await history.click()
  }
  await expect(p.getByTestId(mobile ? 'wiki-revision-mobile' : 'wiki-revision-panel')).toBeVisible()
}

// ── 실데이터 시각 검증(디자이너 게이트, WP-298) ─────────────────────────────────────────────
// 2,000자 넘는 실제 같은 회의록(제목·긴 문단·번호/글머리 목록·표·코드·이미지·멘션)과 판 12개(AI·복원 전·어제·지난 날짜,
// 긴 이름 "김철수외긴이름사용자 외 5명")로 패널·미리보기·모바일 전체화면의 넘침·대비를 본다. 회귀 spec 은 쓰지 않는다.

export const LONG_PAGE_ID = 2820
export const LONG_TITLE = '2026년 4분기 노트 동시 편집·버전 기록 스프린트 리뷰 및 다음 분기 협업 플랫폼 로드맵 정리 회의록'
export const longPagePath = `/wiki/spaces/${REVISION_SPACE_ID}/pages/${LONG_PAGE_ID}`
/** 본문 이미지 경로(목으로 실제 크기 PNG 를 돌려준다). */
export const LONG_IMAGE_PATH = `/api/v1/wiki/pages/${LONG_PAGE_ID}/attachments/9/content`
/** 멘션 칩 라벨(GET /pages/{id}/mentions). */
export const LONG_MENTIONS = [
  { type: 'USER' as const, id: 7, label: '앨리스 (제품기획)', spaceId: null, projectKey: null, number: null },
  { type: 'USER' as const, id: 11, label: '윤서연 (QA)', spaceId: null, projectKey: null, number: null },
  { type: 'PAGE' as const, id: 55, label: '노트 동시 편집 설계 문서', spaceId: REVISION_SPACE_ID, projectKey: null, number: null },
]

const LONG_NAME = { id: 8, name: '김철수외긴이름사용자' }
const VERY_LONG_AI = { id: 9, name: '정우성 (데이터플랫폼 · 검색·추천 파트 시니어 엔지니어)' }
const SIX = [LONG_NAME, KIM, PARK, LEE, CHOI, { id: 10, name: '한지민' }]

/** 본문 조각 — 판마다 일부를 바꿔 블록·글자 단위 차이(표 행·목록 항목·이미지·코드 줄·문단 낱말)를 모두 만든다. */
function longBody(v: {
  decision1: string
  stage2: string
  status2: string
  reviewRow: boolean
  image: boolean
  idle: number
  extraRisk: boolean
  intro: string
  owner: number
}): string {
  return [
    '## 배경',
    `${v.intro} 이번 분기 목표는 여러 사람이 같은 노트를 동시에 열어도 서로의 입력을 잃지 않고, 실수로 지운 내용을 언제든 되돌릴 수 있게 하는 것이다. 지난 분기까지는 마지막 저장이 이기는 방식이라 회의 중 두 사람이 같은 문단을 고치면 한쪽 입력이 조용히 사라졌고, 실제로 스프린트 회고 노트에서 30분 분량의 정리가 덮어써진 사고가 두 번 있었다. 담당 <@${v.owner}> 이 사고 경위와 재현 절차를 <#page:55> 에 정리했다.`,
    '## 결정 사항',
    [
      `1. ${v.decision1}`,
      '2. 버전 기록은 5분 동안 입력이 멈춘 뒤 다시 시작될 때, 30분마다, AI 적용 직전, 복원 직전에 자동으로 남긴다. 사용자가 직접 저장 버튼을 누를 일은 없다.',
      '3. 복원은 본문만 되돌리고 제목은 그대로 둔다. 복원 직전 판도 기록에 남아 복원을 다시 되돌릴 수 있다.',
    ].join('\n'),
    '## 일정',
    [
      '| 단계 | 담당 | 마감 | 상태 |',
      '| --- | --- | --- | --- |',
      '| 서버 스냅샷 정책 | 박민수 | 10월 8일 | 완료 |',
      `| ${v.stage2} | 이영희 | 10월 9일 | ${v.status2} |`,
      '| 모바일 전체화면 목록·미리보기 | 김철수 | 10월 10일 | 예정 |',
      ...(v.reviewRow ? ['| 디자이너 리뷰·실데이터 시각 검증 | 최수진 | 10월 11일 | 예정 |'] : []),
    ].join('\n'),
    ...(v.image ? ['## 구성도', `![동기화 구성도](${LONG_IMAGE_PATH})`] : []),
    '## 설정 예시',
    ['```yaml', 'collab:', '  debounce-ms: 2000', '  max-wait-ms: 10000', '  snapshot:', `    idle-minutes: ${v.idle}`, '    every-minutes: 30', '```'].join('\n'),
    '## 남은 위험',
    [
      '- 아주 긴 문단을 여러 사람이 동시에 고치면 차이 표시가 낱말 단위로 잘게 쪼개져 읽기 어려울 수 있다. 실제 회의록으로 다시 확인한다.',
      '- 모바일 사파리에서 홈 인디케이터 영역이 하단 고정 복원 버튼을 가리지 않는지 실기기로 확인해야 한다.',
      ...(v.extraRisk ? ['- 오래된 브라우저 탭이 옛 스키마로 저장하면 새 노드가 사라질 수 있다 — 스키마 버전 핸드셰이크로 막는다.'] : []),
      '- 판이 200개를 넘으면 오래된 판부터 목록에서 빠진다. 지금 저장 규칙으로는 한 노트에 200개가 쌓이는 데 몇 달이 걸린다.',
    ].join('\n'),
    '회의는 예정보다 20분 늦게 끝났다. 다음 리뷰는 금요일 오후 4시, 같은 회의실에서 디자이너 리뷰 결과와 실기기 확인 결과를 함께 본다. 참석하지 못한 사람은 이 노트의 버전 기록에서 오늘 바뀐 부분을 확인하고 의견을 댓글로 남겨 주기 바란다.',
  ].join('\n\n')
}

const BASE = {
  decision1: '노트 동시 편집은 Yjs + Hocuspocus 로 간다. 배포는 API → collab → 웹 순서로 하고, 롤백 시에는 본문 기준본을 비교해 밖에서 바뀐 본문을 반영한다.',
  // 셀 안 낱말 차이(WP-324)를 긴 한글 셀 글자로 보도록 — 옛 판은 앞부분만 같다.
  stage2: '데스크톱 버전 기록 패널과 미리보기 변경 표시(표는 행·셀 단위로 강조)',
  status2: '진행 중',
  reviewRow: true,
  image: true,
  idle: 5,
  extraRisk: false,
  intro: '노트 동시 편집(WP-171)과 버전 기록(WP-282)을 함께 검토했다.',
  owner: 7,
}
/** 지금(라이브) 본문 — 맨 위 판(v12, AI 적용 직전)과 비교하면 AI 가 바꾼 내용이 보인다. */
export const LONG_LIVE = longBody(BASE)
/** v12 — AI 적용 직전: 첫 결정이 옛 문구, 표 마지막 행·이미지 없음, 코드 idle 10, 위험 한 줄 더. */
const LONG_V12 = longBody({
  ...BASE,
  decision1: '노트 동시 편집은 CRDT 없이 자체 병합으로 간다. 배포 순서는 아직 정하지 않았다.',
  stage2: '데스크톱 버전 기록 패널과 미리보기(표는 통째로 비교)',
  status2: '예정',
  reviewRow: false,
  image: false,
  idle: 10,
  extraRisk: true,
  // 같은 자리 멘션이 다른 사람으로 — 대상만 바뀐 멘션 표시(WP-324) 확인용.
  owner: 11,
})
/** v11 이하 — 결정 전 초안(첫 결정·배경 첫 문장이 다르다). */
const LONG_V11 = longBody({ ...BASE, decision1: '아직 정하지 않았다. 다음 회의에서 CRDT 라이브러리 후보를 비교한다.', status2: '예정', reviewRow: false, image: false, idle: 10, extraRisk: true, intro: '노트 동시 편집을 검토했다.' })

/** 판별 본문 — 오래된 판은 v11 본문을 그대로 쓴다(목록 모양 확인용). */
export const LONG_DETAILS: Record<number, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [i + 1, i + 1 === 12 ? LONG_V12 : LONG_V11]),
)

const longItem = (version: number, iso: string, editors: Person[], opts?: { aiActor?: Person; restore?: boolean }) =>
  revItem(LONG_TITLE, version, iso, editors, opts)

/** 판 12개 — 오늘 5(AI 2·복원 전 1·긴 이름 6명), 어제 3, 10월 5일 2, 9월 28일 2. */
export const LONG_LIST: WikiRevisionList = {
  current: { version: 13, editedAt: at('2026-10-07T14:50:00+09:00'), editors: SIX },
  items: [
    longItem(12, '2026-10-07T14:32:00+09:00', [LEE], { aiActor: LEE }),
    longItem(11, '2026-10-07T14:05:00+09:00', SIX),
    longItem(10, '2026-10-07T13:40:00+09:00', SIX, { restore: true }),
    longItem(9, '2026-10-07T11:20:00+09:00', [LEE], { aiActor: VERY_LONG_AI }),
    longItem(8, '2026-10-07T09:02:00+09:00', [CHOI, PARK]),
    longItem(7, '2026-10-06T17:48:00+09:00', [CHOI]),
    longItem(6, '2026-10-06T16:10:00+09:00', [KIM, LONG_NAME]),
    longItem(5, '2026-10-06T09:30:00+09:00', [PARK]),
    longItem(4, '2026-10-05T18:22:00+09:00', [KIM]),
    longItem(3, '2026-10-05T09:12:00+09:00', [LONG_NAME]),
    longItem(2, '2026-09-28T16:00:00+09:00', [KIM]),
    longItem(1, '2026-09-28T10:00:00+09:00', [KIM]),
  ],
}

/** 실데이터 노트 목 — 이미지(640×280 PNG)·멘션 라벨까지. 편집기·버전 기록 목은 호출자가 깐다(fixture 순환 import 를 피한다). */
export async function mockLongNoteExtras(p: Page) {
  const png = solidPng(640, 280, [120, 144, 200])
  await p.route((u) => u.pathname === LONG_IMAGE_PATH, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: png }))
  await mockWikiMentions(p, LONG_PAGE_ID, LONG_MENTIONS)
}
