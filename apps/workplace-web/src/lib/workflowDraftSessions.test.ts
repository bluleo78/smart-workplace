// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'

import {
  canPersistWorkflowDraftSessions, clearWorkflowDraftSessions, getWorkflowDraftGeneration, getWorkflowDraftSessions,
  invalidateWorkflowDraftSessions, pruneWorkflowDraftSessions, readWorkflowDraftSessions, updateWorkflowDraftSession,
  workflowDraftStorageKey, writeWorkflowDraftSessions,
} from './workflowDraftSessions'

afterEach(() => {
  clearWorkflowDraftSessions()
  window.sessionStorage.clear()
})

it('사용자 신원이 없으면 워크플로 초안을 읽거나 저장할 키를 만들지 않는다', () => {
  const key = workflowDraftStorageKey(undefined, 3, 7)
  writeWorkflowDraftSessions(key, new Map([[42, { edit: null, conflict: false }]]))
  expect(key).toBeNull()
  expect(readWorkflowDraftSessions(key)).toEqual(new Map())
  expect(Object.keys(window.sessionStorage)).toEqual([])
})

it('워크플로 초안만 지우고 같은 탭의 다른 저장값은 남긴다', () => {
  window.sessionStorage.setItem('workflow-drafts:1:3:7', '[]')
  window.sessionStorage.setItem('pending-push-target', 'keep')
  clearWorkflowDraftSessions()
  expect(Object.keys(window.sessionStorage)).toEqual(['pending-push-target'])
})

it('늦은 초안 변경도 같은 저장소의 다른 워크플로 편집을 보존한다', () => {
  const key = workflowDraftStorageKey(1, 3, 7)!
  pruneWorkflowDraftSessions(key, new Set([42, 43]), true)
  const edit42 = { edit: { yaml: '42', expectedDraftUpdatedAt: 'old', baseYaml: '' }, conflict: false }
  const edit43 = { edit: { yaml: '43', expectedDraftUpdatedAt: 'old', baseYaml: '' }, conflict: false }
  updateWorkflowDraftSession(key, 42, edit42)
  updateWorkflowDraftSession(key, 43, edit43)
  updateWorkflowDraftSession(key, 42, null)
  expect([...getWorkflowDraftSessions(key).entries()]).toEqual([[43, edit43]])
})

it('로그아웃 세대가 바뀐 뒤의 지연 응답은 초안을 저장하지 않는다', () => {
  const key = workflowDraftStorageKey(1, 3, 7)!
  const generation = getWorkflowDraftGeneration()
  clearWorkflowDraftSessions()
  const edit = { edit: { yaml: 'old user', expectedDraftUpdatedAt: 'old', baseYaml: '' }, conflict: true }
  expect(updateWorkflowDraftSession(key, 42, edit, generation)).toBe(false)
  expect(window.sessionStorage.getItem(key)).toBeNull()
})

it('테넌트 전환은 이전 요청을 무효화하지만 사용자 범위의 세션 초안은 보존한다', () => {
  const key = workflowDraftStorageKey(1, 3, 7)!
  const edit = { edit: { yaml: '초안', expectedDraftUpdatedAt: '시각', baseYaml: '원본' }, conflict: false }
  updateWorkflowDraftSession(key, 42, edit)
  const generation = getWorkflowDraftGeneration()

  invalidateWorkflowDraftSessions()

  expect(getWorkflowDraftGeneration()).toBe(generation + 1)
  expect(getWorkflowDraftSessions(key).get(42)).toEqual(edit)
  expect(updateWorkflowDraftSession(key, 43, edit, generation)).toBe(false)
})

it('세션 저장소 쓰기가 실패해도 메모리 초안을 유지하고 복원 불가 상태를 알린다', () => {
  const key = workflowDraftStorageKey(1, 3, 7)!
  pruneWorkflowDraftSessions(key, new Set([42]), true)
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota') })
  const edit = { edit: { yaml: 'draft', expectedDraftUpdatedAt: 'old', baseYaml: '' }, conflict: false }
  try {
    expect(updateWorkflowDraftSession(key, 42, edit)).toBe(false)
    expect(canPersistWorkflowDraftSessions(key)).toBe(false)
    expect(getWorkflowDraftSessions(key).get(42)).toEqual(edit)
  } finally {
    write.mockRestore()
  }
})
