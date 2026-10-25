// 구성요소 편집 창의 「(구성원 아님)」 표시(WP-933) — 서버 플래그 defaultAssigneeValid 로만 판단하고,
// 구성원 목록을 불러오는 중에는 유효한 담당자에 경고가 비치지 않아야 한다.
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComponentResponse } from '../../../types/component'
import { ComponentEditDialog } from './ComponentEditDialog'

const membersState: { data: unknown } = { data: undefined }
vi.mock('../../../hooks/queries/useProjectMembers', () => ({
  useProjectMembers: () => membersState,
}))

const assignee = { id: 10, username: 'soon.park', name: '박순', kind: 'HUMAN' }
function component(valid: boolean): ComponentResponse {
  return {
    id: 1,
    name: 'Compute',
    description: null,
    defaultAssignee: assignee,
    defaultAssigneeValid: valid,
    archived: false,
    issueCount: 0,
  } as unknown as ComponentResponse
}
function renderDialog(target: ComponentResponse) {
  // Radix Select 는 닫혀 있어도 숨은 native select 에 선택지를 그려, 문구 유무를 DOM 텍스트로 볼 수 있다.
  return render(<ComponentEditDialog projectKey="WP" open target={target} onSave={async () => {}} onClose={() => {}} />, {
    container: document.body,
  })
}

describe('ComponentEditDialog 담당자 경고', () => {
  beforeEach(() => {
    membersState.data = undefined
  })

  it('구성원 목록을 불러오는 중에는 유효한 담당자에 「(구성원 아님)」이 비치지 않는다', () => {
    renderDialog(component(true))
    expect(document.body.textContent).not.toContain('구성원 아님')
  })

  it('서버가 무효라고 한 담당자는 「(구성원 아님)」으로 남긴다', () => {
    renderDialog(component(false))
    expect(document.body.textContent).toContain('박순 (구성원 아님)')
  })

  it('구성원 목록을 불러온 뒤에도 유효한 담당자엔 경고가 없다', () => {
    membersState.data = [{ userId: 10, name: '박순', kind: 'HUMAN', active: true }]
    renderDialog(component(true))
    expect(document.body.textContent).not.toContain('구성원 아님')
  })
})
