// pushUndo 순수 함수 단위 테스트(WP-1762) — 되돌리기 스택 상한(MAX_UNDO)을 UI 51번 조작 없이 확인한다.
import { expect, test } from 'vitest'

import type { DashboardWidgetConfig } from '@/types/dashboard'

import { jsonEqual, MAX_UNDO, pushUndo } from './useDashboardEditDraft'

/** 구분용 id 를 가진 한 위젯짜리 스냅샷. */
const snap = (id: string): DashboardWidgetConfig[] => [{ id, type: 'my_tasks', count: 5, hidden: false }]

test('상한(50) 안에서는 끝에 쌓는다', () => {
  const next = pushUndo([snap('a')], snap('b'))
  expect(next).toHaveLength(2)
  expect(next[1][0].id).toBe('b')
})

test('51개째를 쌓으면 가장 오래된 것을 잘라 50개로 유지한다', () => {
  const stack = Array.from({ length: MAX_UNDO }, (_, i) => snap(`s${i}`))
  const next = pushUndo(stack, snap('new'))
  expect(next).toHaveLength(MAX_UNDO)
  expect(next[0][0].id).toBe('s1')
  expect(next.at(-1)![0].id).toBe('new')
})

// 설정 적용이 실제로 바뀐 게 있는지 가르는 비교 — 저장하면 같아지는 차이(키 순서·undefined 값 키)는 같다고 본다.
test('jsonEqual — 키 순서는 무시하고 값이 undefined 인 키는 없는 키로 본다', () => {
  expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true)
  expect(jsonEqual({ a: 1, status: undefined }, { a: 1 })).toBe(true)
  expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false)
  expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
  expect(jsonEqual({ a: [] }, { a: {} })).toBe(false)
  expect(jsonEqual({ a: null }, { a: undefined })).toBe(false)
})
