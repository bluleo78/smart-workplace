// 저장소 호스트 판정 — 호스트 입력 검증, 종류 짐작, 연결 줄 묶기, 빠진 호스트.
import { describe, expect, it } from 'vitest'

import type { AgentRepoCredential, AgentRuntimeProject } from '../types/agentRuntime'
import { guessRepoKind, missingRepoHosts, normalizeRepoHost, repoConnectionRows } from './repoHosts'

// 호스트는 서버가 계산해 주는 값 — 못 읽는 저장소는 repositoryHost null
const project = (projectKey: string, repositoryUrl: string | null, repositoryHost: string | null): AgentRuntimeProject => ({
  projectKey,
  name: projectKey,
  repositoryUrl,
  repositoryBranch: 'main',
  repositoryHost,
})
const cred = (host: string, kind: AgentRepoCredential['kind'] = 'GITHUB'): AgentRepoCredential => ({
  id: host.length,
  kind,
  host,
  createdAt: '2026-11-02T00:00:00Z',
  lastUsedAt: null,
})

describe('normalizeRepoHost', () => {
  it('앞뒤 공백을 지우고 소문자로 맞춘다', () => expect(normalizeRepoHost('  GitHub.COM ')).toBe('github.com'))
  it('스킴·포트·경로가 있으면 null', () => {
    expect(normalizeRepoHost('https://github.com')).toBeNull()
    expect(normalizeRepoHost('github.com:443')).toBeNull()
    expect(normalizeRepoHost('github.com/a')).toBeNull()
    expect(normalizeRepoHost('')).toBeNull()
  })
  it('240자까지만 — runner 의 Secret 키 길이 상한 때문', () => {
    const host240 = ['a'.repeat(60), 'a'.repeat(60), 'a'.repeat(60), 'a'.repeat(57)].join('.')
    expect(host240).toHaveLength(240)
    expect(normalizeRepoHost(host240)).toBe(host240)
    expect(normalizeRepoHost(`${host240}a`)).toBeNull()
  })
})

describe('guessRepoKind', () => {
  it('host 에 github 가 들어가면 GITHUB, 아니면 GITLAB', () => {
    expect(guessRepoKind('github.com')).toBe('GITHUB')
    expect(guessRepoKind('ghe.github.example.com')).toBe('GITHUB')
    expect(guessRepoKind('gitlab.iacloud.kr')).toBe('GITLAB')
    expect(guessRepoKind('code.example.com')).toBe('GITLAB')
  })
})

describe('repoConnectionRows·missingRepoHosts', () => {
  const projects = [
    project('WP', 'https://github.com/a/wp.git', 'github.com'),
    project('WD', 'git@github.com:a/wd.git', 'github.com'),
    project('TTP', 'https://gitlab.iacloud.kr/t/ttp', 'gitlab.iacloud.kr'),
    project('X', 'garbage', null),
    project('Y', null, null),
  ]

  it('필요한 호스트를 프로젝트 키와 함께 호스트 순으로, 연결 여부는 credential 로 보인다', () => {
    const rows = repoConnectionRows(projects, [cred('github.com')])
    expect(rows.map((r) => r.host)).toEqual(['github.com', 'gitlab.iacloud.kr'])
    expect(rows[0]).toMatchObject({ kind: 'GITHUB', projectKeys: ['WP', 'WD'] })
    expect(rows[0].credential).not.toBeNull()
    expect(rows[1]).toMatchObject({ kind: 'GITLAB', projectKeys: ['TTP'], credential: null })
  })

  it('필요 없는데 등록된 호스트는 필요한 호스트 뒤에, 프로젝트 없이, 등록된 종류로 붙는다', () => {
    const rows = repoConnectionRows(projects, [cred('github.com'), cred('a.example.com', 'GITLAB'), cred('ghe.example.com', 'GITHUB')])
    expect(rows.map((r) => r.host)).toEqual(['github.com', 'gitlab.iacloud.kr', 'a.example.com', 'ghe.example.com'])
    expect(rows[2]).toMatchObject({ kind: 'GITLAB', projectKeys: [] })
  })

  it('missingRepoHosts 는 필요한데 토큰이 없는 호스트만 호스트 순으로', () => {
    expect(missingRepoHosts(projects, [])).toEqual(['github.com', 'gitlab.iacloud.kr'])
    expect(missingRepoHosts(projects, [cred('github.com')])).toEqual(['gitlab.iacloud.kr'])
    expect(missingRepoHosts([], [])).toEqual([])
  })
})
