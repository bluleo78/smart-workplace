// 개인 보고 달 폴더 제목 판정 — 서버 PersonalReportMonthFolder 와 같은 규칙(`N년 M월`, 월 1–12)인지 본다.
import { describe, expect, test } from 'vitest'

import { isMonthFolderTitle } from './reportMonthFolder'

describe('isMonthFolderTitle', () => {
  test.each(['2026년 11월', '2026년 1월', '2026년 12월', '2026년 01월'])('%s 는 달 폴더다', (title) => {
    expect(isMonthFolderTitle(title)).toBe(true)
  })

  test.each([
    '2026년 13월',
    '2026년 0월',
    '2026년 00월',
    '2026년 11월 회의',
    '26년 11월',
    '2026년  11월',
    ' 2026년 11월',
    '2026년 11월 ',
    '2026년 111월',
    '',
  ])('%j 는 달 폴더가 아니다', (title) => {
    expect(isMonthFolderTitle(title)).toBe(false)
  })
})
