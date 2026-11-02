// runner 설치 순서(WP-1256) — README 와 같은 4단계(마지막은 선택), 토큰 원문 미포함, --set-file, dev 버전 자리표시.
import { describe, expect, test } from 'vitest'

import { isIpv4, METRICS_SERVER_MANIFEST, runnerInstallSteps } from './runnerInstall'

const URL = 'https://genia-works.iacloud.kr'

describe('runnerInstallSteps', () => {
  test('네 단계이고 순서는 네임스페이스 → pull secret → helm 설치 → (선택) metrics-server', () => {
    const steps = runnerInstallSteps(URL, '0.9.38')
    expect(steps).toHaveLength(4)
    expect(steps[0].command).toContain('create namespace')
    expect(steps[0].command).toContain('pod-security.kubernetes.io/enforce=privileged')
    expect(steps[1].command).toContain('create secret docker-registry dockerhub-pull')
    expect(steps[2].command).toContain('helm --kube-context <ctx> install agent-runner deploy/helm-agent-runner')
    // WP-1280 — 선택 단계라 제목에 (선택), 없으면 CPU·메모리가 「알 수 없음」이라는 안내
    expect(steps[3].title).toMatch(/^\(선택\)/)
    expect(steps[3].command).toBe(`kubectl --context <ctx> apply -f ${METRICS_SERVER_MANIFEST}`)
    expect(steps[3].note).toContain('알 수 없음')
  })

  test('설치 명령에 Works 주소와 이미지 태그가 들어가고, 토큰은 --set-file 로 파일에서 읽는다', () => {
    const install = runnerInstallSteps(URL, '0.9.38')[2].command
    expect(install).toContain(`--set works.url=${URL}`)
    expect(install).toContain('--set image.tag=0.9.38')
    expect(install).toContain('--set-file runnerToken=./runner-token.txt')
    // --set runnerToken=<값> 형태(셸 기록에 남는 방식)는 쓰지 않는다.
    expect(install).not.toMatch(/--set\s+runnerToken=/)
    // WP-1268 — 저장소 토큰은 AI 별로 화면에서 넣는다. 위치 GitHub Secret 값은 없다
    expect(install).not.toContain('github.existingSecret')
    expect(install).not.toContain('github-token')
  })

  test('설치 단계 안내에 AI 작업 폴더가 노드 로컬(/var/lib/genia-agents)에 생긴다고 적는다(WP-1270)', () => {
    expect(runnerInstallSteps(URL, '0.9.38')[2].note).toContain('/var/lib/genia-agents')
  })

  test('어떤 단계에도 토큰 원문(rt_…)이 들어가지 않는다', () => {
    const all = runnerInstallSteps(URL, '0.9.38')
      .map((s) => `${s.title}\n${s.command}\n${s.note ?? ''}`)
      .join('\n')
    expect(all).not.toMatch(/rt_[0-9a-f]{4}/)
  })

  test('로컬 빌드 dev 버전이면 이미지 태그는 「<릴리스 버전>」 자리표시', () => {
    const install = runnerInstallSteps(URL, 'dev')[2].command
    expect(install).toContain('--set image.tag=<릴리스 버전>')
    expect(install).not.toContain('image.tag=dev')
  })

  test('모든 단계에 제목이 있고 명령이 비어 있지 않다', () => {
    for (const s of runnerInstallSteps(URL, '1.0.0')) {
      expect(s.title).not.toBe('')
      expect(s.command).not.toBe('')
    }
  })

  test('내부 IP 를 넣으면 설치 명령에 Works 호스트 이름을 그 IP 로 푸는 hostAliases 가 들어간다', () => {
    const install = runnerInstallSteps(URL, '0.9.38', ' 192.168.100.72 ')[2].command
    expect(install).toContain("--set 'hostAliases[0].ip=192.168.100.72'")
    expect(install).toContain("--set 'hostAliases[0].hostnames[0]=genia-works.iacloud.kr'")
    // 줄 이음이 끊기지 않는다 — 마지막 줄만 역슬래시가 없다
    const lines = install.split('\n')
    expect(lines.slice(0, -1).every((l) => l.endsWith('\\'))).toBe(true)
  })

  test('내부 IP 를 비우면 설치 명령은 지금과 같다', () => {
    expect(runnerInstallSteps(URL, '0.9.38', '')[2].command).toBe(runnerInstallSteps(URL, '0.9.38')[2].command)
    expect(runnerInstallSteps(URL, '0.9.38', '   ')[2].command).not.toContain('hostAliases')
  })
})

describe('isIpv4', () => {
  test('점 네 칸의 0~255 만 IP 로 본다', () => {
    expect(isIpv4('192.168.100.72')).toBe(true)
    expect(isIpv4('10.0.0.5')).toBe(true)
    expect(isIpv4('256.1.1.1')).toBe(false)
    expect(isIpv4('192.168.1')).toBe(false)
    expect(isIpv4('genia-works.iacloud.kr')).toBe(false)
    expect(isIpv4('')).toBe(false)
    // 앞자리 0 은 쿠버네티스가 거절하거나 8진수로 읽는다.
    expect(isIpv4('192.168.010.072')).toBe(false)
    expect(isIpv4('10.0.0.0')).toBe(true)
  })
})
