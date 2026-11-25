// 하위 태스크 유형 변경 순수 함수(WP-2098) — 후보 거르기·기본값·대상 자식 판정.
import { expect, test } from 'vitest'

import { createIssue } from '../../e2e/factories/issue.factory'
import { makeIssueType, makeSubtaskType, makeTaskType, systemTypes } from '../../e2e/factories/issueType.factory'
import { convertTargetTypes, defaultConvertTypeId, subtaskChildrenOf } from './issueTypeSubtaskConvert'

test('convertTargetTypes: EPIC·SUBTASK 를 빼고 원래 순서를 지킨다', () => {
  expect(convertTargetTypes(systemTypes()).map((t) => t.name)).toEqual(['TASK', 'BUG', 'STORY', 'CHORE'])
})

test('defaultConvertTypeId: TASK 가 기본, 없으면 첫 후보, 후보가 없으면 undefined', () => {
  const types = systemTypes()
  expect(defaultConvertTypeId(types)).toBe(1)
  expect(defaultConvertTypeId(types.filter((t) => t.name !== 'TASK'))).toBe(2)
  expect(defaultConvertTypeId([makeIssueType({ id: 9, name: 'EPIC' })])).toBeUndefined()
})

test('subtaskChildrenOf: 하위 태스크만 남긴다', () => {
  const sub = createIssue({ id: 1, number: 1, type: makeSubtaskType() })
  const task = createIssue({ id: 2, number: 2, type: makeTaskType() })
  expect(subtaskChildrenOf([sub, task])).toEqual([sub])
})
