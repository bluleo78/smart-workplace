// 커스텀 필드(Phase 4c·#148·#317·#318·#779·#784·#813·WP-611) — 페이지 테스트(WP-971).
// 설정 화면의 필드 목록(한국어 타입 라벨·옵션 칩·필드별 삭제 이름)·삭제 확인·편집 PATCH 와 409 문구,
// 이슈 상세의 NUMBER 안전 범위 거부·DATE 선택/지우기 payload 는 브라우저 없이 판정되므로
// e2e/pages/projects/custom-fields.spec.ts 에서 옮겼다. 설정에서 필드 추가 → 이슈 상세에서 값 입력으로 이어지는 흐름(@flow)은 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { server } from '@/test/msw/server'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { FieldType,IssueFieldDef } from '@/types/customField'
import type { IssueDetailResponse } from '@/types/issue'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const FIELDS = `/api/v1/projects/${KEY}/fields`
const ISSUE = `/api/v1/projects/${KEY}/issues/1`

/** 필드 정의 팩토리. */
const fieldDef = (over: Partial<IssueFieldDef> & Pick<IssueFieldDef, 'id' | 'name' | 'type'>): IssueFieldDef => ({
  projectId: 1,
  options: null,
  position: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
})

/** 프로젝트·멤버(나는 OWNER)·라벨 — 설정과 상세가 함께 부른다. */
const projectHandlers = () => [
  http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ id: 1, key: KEY }))),
  http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, role: 'OWNER' })])),
]

/** 설정 화면 — fields 는 매 GET 마다 읽는다(쓰기 핸들러가 바꾸면 재조회에 반영). 필드는 1개 이상 준다. */
async function openSettings(fields: { current: IssueFieldDef[] }) {
  const view = renderPage(`/projects/${KEY}/settings`, {
    handlers: [
      ...projectHandlers(),
      http.get(FIELDS, () => HttpResponse.json(fields.current)),
      http.get(`/api/v1/projects/${KEY}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    ],
  })
  // 추가 폼은 목록보다 먼저 뜬다 — 첫 필드 행까지 기다린다.
  await screen.findByTestId(`custom-field-row-${fields.current[0].id}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

type FieldValue = { defId: number; name: string; type: FieldType; value: unknown }

/** 이슈 상세 — 필드 값 PUT 을 서버처럼 반영하고 본문을 puts 에 모은다. 커스텀 필드 그룹을 펼친 채 돌려준다. */
async function openIssue(def: IssueFieldDef, initial: FieldValue[] = []) {
  const puts: Array<{ values: Array<{ defId: number; value: unknown }> }> = []
  const writes: string[] = []
  let summary = { ...createIssue({ id: 1, number: 1, title: 't' }), type: makeTaskType(), customFields: initial }
  const detail = (): IssueDetailResponse => createIssueDetail({ summary, body: '' })
  const view = renderPage(`/projects/${KEY}/issues/1`, {
    handlers: [
      ...projectHandlers(),
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(FIELDS, () => HttpResponse.json([def])),
      http.get(ISSUE, () => HttpResponse.json(detail())),
      ...['watchers', 'labels', 'attachments', 'children'].map((sub) => http.get(`${ISSUE}/${sub}`, () => HttpResponse.json([]))),
      http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
      http.all(`${ISSUE}/fields`, async ({ request }) => {
        writes.push(request.method)
        const body = (await request.json()) as (typeof puts)[number]
        puts.push(body)
        const map = new Map(summary.customFields.map((e) => [e.defId, e]))
        for (const v of body.values) {
          if (v.value == null) map.delete(v.defId)
          else map.set(v.defId, { defId: v.defId, name: def.name, type: def.type, value: v.value })
        }
        summary = { ...summary, customFields: [...map.values()] }
        return HttpResponse.json(detail())
      }),
    ],
  })
  // 커스텀 필드 그룹은 기본 접힘 — 펼쳐야 섹션이 마운트된다(#343).
  await view.user.click(await screen.findByRole('button', { name: /커스텀 필드/ }, { timeout: PAGE_LOAD_TIMEOUT }))
  await screen.findByTestId('custom-fields-section')
  return { ...view, puts, writes }
}

describe('커스텀 필드 — 설정 화면', () => {
  test('타입은 한국어 라벨로 보이고, 타입 고르기는 shadcn Select(combobox)로 한국어 옵션을 고른다 (#317)', async () => {
    const { user } = await openSettings({ current: [fieldDef({ id: 300, name: '텍스트필드', type: 'TEXT' })] })
    const row = screen.getByTestId('custom-field-row-300')
    expect(row).toHaveTextContent('텍스트')
    expect(row).not.toHaveTextContent('TEXT')
    const trigger = screen.getByTestId('cf-type-select')
    expect(trigger).toHaveRole('combobox')
    // Radix Select 는 jsdom 에 없는 포인터 캡처를 쓰므로 키보드로 열고 고른다(같은 선택 상태를 레이아웃 없이 만든다).
    trigger.focus()
    await user.keyboard('{Enter}')
    // 타입별 라벨 전체는 fieldNumber.test 의 FIELD_TYPE_LABEL 단위 테스트(WP-412) — 여기서는 옵션이 한국어로 그려지고 고른 값이 반영되는지.
    const date = await screen.findByTestId('cf-type-option-DATE')
    expect(date).toHaveTextContent('날짜')
    date.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(trigger).toHaveTextContent('날짜'))
  })

  test('필드마다 삭제 버튼의 접근성 이름이 필드명을 담아 서로 구분된다 (#779)', async () => {
    await openSettings({
      current: [fieldDef({ id: 501, name: '스토리포인트', type: 'NUMBER' }), fieldDef({ id: 502, name: '비고', type: 'TEXT', position: 2 })],
    })
    expect(within(screen.getByTestId('custom-field-row-501')).getByRole('button', { name: '스토리포인트 삭제' })).toBeInTheDocument()
    expect(within(screen.getByTestId('custom-field-row-502')).getByRole('button', { name: '비고 삭제' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '스토리포인트 삭제' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '비고 삭제' })).toHaveLength(1)
  })

  test('SELECT·MULTI_SELECT 옵션은 raw 배열 문구가 아니라 옵션별 칩으로 보인다 (#784)', async () => {
    await openSettings({
      current: [
        fieldDef({ id: 601, name: '우선순위', type: 'SELECT', options: ['낮음', '보통', '높음'] }),
        fieldDef({ id: 602, name: '태그', type: 'MULTI_SELECT', options: ['긴급', '검토필요'], position: 2 }),
      ],
    })
    const rowSelect = screen.getByTestId('custom-field-row-601')
    const rowMulti = screen.getByTestId('custom-field-row-602')
    for (const opt of ['낮음', '보통', '높음']) expect(within(rowSelect).getByText(opt, { exact: true })).toBeInTheDocument()
    for (const opt of ['긴급', '검토필요']) expect(within(rowMulti).getByText(opt, { exact: true })).toBeInTheDocument()
    expect(rowSelect).not.toHaveTextContent('[낮음, 보통, 높음]')
    expect(rowMulti).not.toHaveTextContent('[긴급, 검토필요]')
    expect([...rowSelect.querySelectorAll('span')].filter((s) => s.textContent?.includes('['))).toHaveLength(0)
  })

  test('삭제는 이슈 값까지 지워진다는 확인 대화상자를 거쳐 DELETE 하고 목록에서 빠진다 (#148)', async () => {
    const fields = { current: [fieldDef({ id: 200, name: '삭제필드', type: 'TEXT' })] }
    const deletes: string[] = []
    const { user } = await openSettings(fields)
    // 쓰기 핸들러는 화면을 띄운 뒤 붙여도 된다 — 버튼을 누르기 전까지 요청이 없다.
    server.use(
      http.delete(`${FIELDS}/200`, () => {
        deletes.push('DELETE')
        fields.current = []
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await user.click(screen.getByTestId('custom-field-delete-200'))
    const dialog = await screen.findByTestId('custom-field-delete-dialog')
    expect(dialog).toHaveTextContent('이슈 값들과 함께 삭제')
    expect(deletes).toEqual([])
    await user.click(screen.getByTestId('custom-field-delete-confirm'))
    await waitFor(() => expect(deletes).toEqual(['DELETE']))
    await waitFor(() => expect(screen.queryByTestId('custom-field-row-200')).not.toBeInTheDocument())
  })

  // WP-611 — 필드 이름·옵션을 고칠 방법이 없어 옵션 하나를 더하려면 필드를 지워 모든 이슈 값을 잃어야 했다.
  test('편집 — 이름·옵션을 고쳐 PATCH(공백·빈 옵션 정리)하고, 쓰는 옵션을 빼면 409 문구를 대화상자 안에 보인다 (WP-611)', async () => {
    const fields = { current: [fieldDef({ id: 400, name: '진행 단계', type: 'SELECT', options: ['기획', '개발'] })] }
    const patches: unknown[] = []
    let rejectNext = false
    const { user } = await openSettings(fields)
    server.use(
      http.patch(`${FIELDS}/400`, async ({ request }) => {
        const body = (await request.json()) as { name: string; options: string[] }
        patches.push(body)
        if (rejectNext) {
          return HttpResponse.json({ status: 409, message: '2건의 이슈가 참조 중인 옵션은 삭제할 수 없습니다: 기획' }, { status: 409 })
        }
        fields.current = [{ ...fields.current[0], name: body.name, options: body.options }]
        return HttpResponse.json(fields.current[0])
      }),
    )
    const row = screen.getByTestId('custom-field-row-400')
    expect(row).toHaveTextContent('진행 단계')

    // 편집 — 이름과 옵션이 채워져 열린다. 이름을 바꾸고 옵션을 하나 더한다.
    await user.click(screen.getByTestId('custom-field-edit-400'))
    let dialog = await screen.findByTestId('custom-field-edit-dialog')
    const name = within(dialog).getByLabelText(/^이름/)
    const options = within(dialog).getByLabelText(/^옵션 \(콤마 구분\)/)
    expect(name).toHaveValue('진행 단계')
    expect(options).toHaveValue('기획, 개발')
    await user.clear(name)
    await user.paste('개발 단계')
    await user.clear(options)
    await user.paste('기획, 개발,  검수 ,')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByTestId('custom-field-edit-dialog')).not.toBeInTheDocument())
    expect(patches[0]).toEqual({ name: '개발 단계', type: 'SELECT', options: ['기획', '개발', '검수'] })
    await waitFor(() => expect(screen.getByTestId('custom-field-row-400')).toHaveTextContent('개발 단계'))
    expect(screen.getByTestId('custom-field-row-400')).toHaveTextContent('검수')

    // 쓰는 중인 옵션(기획)을 빼면 서버가 거절 — 대화상자를 닫지 않고 그 문구를 보인다.
    rejectNext = true
    await user.click(screen.getByTestId('custom-field-edit-400'))
    dialog = await screen.findByTestId('custom-field-edit-dialog')
    const options2 = within(dialog).getByLabelText(/^옵션 \(콤마 구분\)/)
    await user.clear(options2)
    await user.paste('개발, 검수')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('2건의 이슈가 참조 중인 옵션은 삭제할 수 없습니다: 기획')
    expect(screen.getByTestId('custom-field-edit-dialog')).toBeInTheDocument()
  })
})

describe('커스텀 필드 — 이슈 상세 값', () => {
  test('NUMBER 에 안전 정수 범위를 넘는 값을 넣으면 경고 토스트를 띄우고 이전 값으로 되돌리며 저장하지 않는다 (#813)', async () => {
    const def = fieldDef({ id: 700, name: '숫자필드테스트', type: 'NUMBER' })
    const { writes } = await openIssue(def, [{ defId: 700, name: def.name, type: 'NUMBER', value: 5 }])
    const input = screen.getByTestId('field-input-700')
    expect(input).toHaveValue(5)
    // Number.MAX_SAFE_INTEGER(2^53-1) 를 훨씬 넘는 23자리 정수.
    // 값을 한 번에 넣는다 — 글자마다 넣으면 중간값(9, 99…)이 디바운스 저장을 일으킨다.
    fireEvent.change(input, { target: { value: '99999999999999999999999' } })
    expect(await screen.findByText(/안전한 정수 범위/)).toBeInTheDocument()
    // 지수표기(1e+23)로 남지 않고 기존 유효값(5)으로 돌아간다.
    await waitFor(() => expect(input).toHaveValue(5))
    // 정밀도를 잃은 값이 서버로 가지 않는다 — 디바운스(300ms)보다 넉넉히 기다려 본다.
    await new Promise((r) => setTimeout(r, 500))
    expect(writes).toEqual([])
  })

  test('DATE 는 버튼 트리거의 달력에서 고르면 ISO 날짜로 PUT 하고, 지우기는 null 로 PUT 한다 (#318)', async () => {
    const def = fieldDef({ id: 400, name: '마감목표일', type: 'DATE' })
    const { user, puts } = await openIssue(def)
    const valueOf = () => puts.at(-1)?.values.find((v) => v.defId === 400)?.value
    // 트리거는 native 입력이 아니라 버튼(PopoverTrigger)이고, 값이 없으면 「날짜 선택」.
    const trigger = screen.getByTestId('field-input-400')
    expect(trigger).toHaveRole('button')
    expect(trigger).toHaveTextContent('날짜 선택')

    await user.click(trigger)
    // 이번 달 15일(달력 버튼 이름은 「YYYY년 M월 15일 …」).
    await user.click(await screen.findByRole('button', { name: /월 15일/ }))
    await waitFor(() => expect(valueOf()).toMatch(/^\d{4}-\d{2}-15$/))
    await waitFor(() => expect(screen.getByTestId('field-input-400')).not.toHaveTextContent('날짜 선택'))

    await user.click(await screen.findByTestId('field-input-400-clear'))
    await waitFor(() => expect(valueOf()).toBeNull())
    await waitFor(() => expect(screen.getByTestId('field-input-400')).toHaveTextContent('날짜 선택'))
  })
})
