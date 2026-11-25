// useExternalEditNotice — 같은 번호의 다른 프로젝트 이슈로 옮겨 가도 가짜 토스트가 뜨지 않는다(WP-2095 최종 리뷰).
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useExternalEditNotice } from './useExternalEditNotice'
import type { SavedFields } from './useVersionedPatch'

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: toastMock }))

type Source = Parameters<typeof useExternalEditNotice>[0]

describe('useExternalEditNotice', () => {
  beforeEach(() => toastMock.mockClear())

  it('같은 이슈에서 남이 제목을 바꾸면 토스트를 띄운다', () => {
    const own = () => new Map<number, SavedFields>()
    const { rerender } = renderHook(({ data }: { data: Source }) => useExternalEditNotice(data, own), {
      initialProps: { data: { projectKey: 'WP', number: 12, version: 1, title: 'A', body: '' } as Source },
    })
    rerender({ data: { projectKey: 'WP', number: 12, version: 2, title: 'B', body: '' } })
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it('번호가 같아도 프로젝트가 다른 이슈로 옮겨 가면 토스트를 띄우지 않는다', () => {
    const own = () => new Map<number, SavedFields>()
    const { rerender } = renderHook(({ data }: { data: Source }) => useExternalEditNotice(data, own), {
      initialProps: { data: { projectKey: 'WP', number: 12, version: 1, title: 'A', body: '' } as Source },
    })
    rerender({ data: { projectKey: 'OTHER', number: 12, version: 5, title: 'B', body: '' } })
    expect(toastMock).not.toHaveBeenCalled()
  })

  // 코드 리뷰 지적 1·5 — 내 저장이 만든 version 이어도 그 사이 남이 바꾼 다른 필드는 알려야 한다(내가 저장한 필드만 뺀다).
  it('내 저장 version 으로 건너뛰어도 내가 저장하지 않은 필드를 남이 바꿨으면 알린다', () => {
    // 남이 본문을 v2 로 바꾸고, 내가 제목을 저장해 v3 — 화면은 v1 → v3 으로 바로 바뀐다.
    const own = () => new Map<number, SavedFields>([[3, { title: '내 제목' }]])
    const { rerender } = renderHook(({ data }: { data: Source }) => useExternalEditNotice(data, own), {
      initialProps: { data: { projectKey: 'WP', number: 12, version: 1, title: 'A', body: '옛 본문' } as Source },
    })
    rerender({ data: { projectKey: 'WP', number: 12, version: 3, title: '내 제목', body: '남의 본문' } })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0]).toContain('본문')
  })

  it('내 저장이 바꾼 필드만 달라졌으면 알리지 않는다', () => {
    const own = () => new Map<number, SavedFields>([[2, { title: '내 제목' }]])
    const { rerender } = renderHook(({ data }: { data: Source }) => useExternalEditNotice(data, own), {
      initialProps: { data: { projectKey: 'WP', number: 12, version: 1, title: 'A', body: '' } as Source },
    })
    rerender({ data: { projectKey: 'WP', number: 12, version: 2, title: '내 제목', body: '' } })
    expect(toastMock).not.toHaveBeenCalled()
  })

  // 코드 리뷰 지적 1 — 내 저장 직후 캐시는 새 version·옛 값이다. 다음 version(남의 상태 변경)의 refetch 가 내 값을 가져와도 남 탓하지 않는다.
  it('내 저장 뒤 남이 다른 속성을 바꿔 내 값이 보여도 내 편집을 남의 변경으로 알리지 않는다', () => {
    const own = () => new Map<number, SavedFields>([[4, { title: 'B' }]])
    const { rerender } = renderHook(({ data }: { data: Source }) => useExternalEditNotice(data, own), {
      initialProps: { data: { projectKey: 'WP', number: 12, version: 3, title: 'A', body: '' } as Source },
    })
    rerender({ data: { projectKey: 'WP', number: 12, version: 4, title: 'A', body: '' } })
    rerender({ data: { projectKey: 'WP', number: 12, version: 5, title: 'B', body: '' } })
    expect(toastMock).not.toHaveBeenCalled()
  })
})
