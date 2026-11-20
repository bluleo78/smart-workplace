// 이슈 드라이브 링크 행의 × 단추 접근 이름(WP-1871) — 링크가 여러 개여도 스크린리더가 대상을 구분한다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { DriveLink } from '@/types/drive'

import { IssueDriveLinkItem } from './IssueDriveLinkItem'

/** 테스트용 드라이브 링크 — ACTIVE 상태 기본값에 필요한 필드만 덮어쓴다. */
function makeLink(driveFileId: number, name: string): DriveLink {
  return {
    driveFileId,
    fileId: driveFileId + 100,
    name,
    mimeType: 'application/octet-stream',
    sizeBytes: 1024,
    hasThumbnail: false,
    spaceId: 1,
    spaceName: '팀 공간',
    availability: 'ACTIVE',
    createdById: 1,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

const links = [makeLink(11, '회의록.docx'), makeLink(12, '예산.xlsx')]

/** 두 행을 <ul> 안에 렌더한다. */
function renderRows(canManage: boolean, onRemove = vi.fn()) {
  renderWithProviders(
    <ul>
      {links.map((l) => (
        <IssueDriveLinkItem
          key={l.driveFileId}
          projectKey="WP"
          number={1}
          link={l}
          canManage={canManage}
          onRemove={onRemove}
          onPreview={() => {}}
        />
      ))}
    </ul>,
  )
  return onRemove
}

describe('IssueDriveLinkItem — × 단추', () => {
  it('두 드라이브 링크의 × 단추는 각 링크 이름을 담아 서로 다르다', () => {
    renderRows(true)
    expect(screen.getByRole('button', { name: '회의록.docx 드라이브 링크 제거' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '예산.xlsx 드라이브 링크 제거' })).toBeInTheDocument()
  })

  it('× 를 누르면 그 링크의 driveFileId 로 onRemove', async () => {
    const onRemove = renderRows(true)
    await userEvent.click(screen.getByRole('button', { name: '예산.xlsx 드라이브 링크 제거' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(12)
  })

  it('canManage=false 면 × 단추가 없다', () => {
    renderRows(false)
    expect(screen.queryByRole('button', { name: /링크 제거$/ })).toBeNull()
  })
})
