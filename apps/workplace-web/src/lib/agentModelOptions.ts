// 작업 설정 「모델」 칸 선택지(WP-1405) — 템플릿 칸이 optionsFrom: account-models 이면 그 AI 에 연결된 계정의 모델 목록으로 선택지를 채운다.
// 화면(WorkSettingsFields)은 조회 결과를 이 함수에 넘기기만 한다 — 합치기·상태 판정·저장값 보존 규칙을 한 곳에서 단위 테스트하려고 순수 함수로 둔다.

import type { AgentTemplateConfigField, AgentTemplateOption } from '../types/agentRuntime'
import type { CredentialProvider, ModelOption } from '../types/providerCredential'
import { accountFits, accountLabel } from './agentAccount'
import { apiErrorStatus } from './api-error'

/**
 * 모델 목록 상태 — loading=조회 중, live=계정 목록을 받음, noAccount=AI 계정이 연결돼 있지 않음,
 * otherAccount=연결된 계정 종류가 이 방식의 계정과 다름(그 계정의 목록은 조회하지 않는다), failed=그 밖의 실패·빈 목록.
 */
export type ModelOptionsStatus = 'loading' | 'live' | 'noAccount' | 'otherAccount' | 'failed'

/** 칸 아래 도움말 한 줄 — live 는 없다. 서버 오류 메시지를 그대로 붙이지 않는다(토큰·내부 정보가 섞일 수 있어서). */
function hintOf(status: ModelOptionsStatus, account: CredentialProvider | null | undefined): string | null {
  switch (status) {
    case 'loading':
      return '계정의 모델 목록을 불러오는 중이에요.'
    case 'live':
      return null
    case 'noAccount':
      return 'AI 계정을 연결하면 그 계정이 쓸 수 있는 모델이 보여요.'
    case 'otherAccount':
      // 계정 이름은 화면 공통 표(accountLabel)에서 — AI 계정 묶음과 같은 이름으로 보인다.
      return account
        ? `연결된 AI 계정이 이 실행 방식에 맞지 않아 기본 선택지를 보여요. ${accountLabel(account)} 계정을 연결하면 그 계정의 모델이 보여요.`
        : '연결된 AI 계정이 이 실행 방식에 맞지 않아 기본 선택지를 보여요.'
    case 'failed':
      return '계정의 모델 목록을 불러오지 못해 기본 선택지를 보여요.'
  }
}

/** 이 AI 에 연결된 AI 계정 조회 결과 중 이 함수가 보는 부분 — provider 가 null 이면 연결 없음, undefined 면 아직 모르거나 조회 실패. */
export interface AgentCredentialQuery {
  provider: CredentialProvider | null | undefined
  isPending: boolean
}

/**
 * 저장값 보존(WP-1405) — 저장값이 비어 있지 않은데 선택지에 없으면 그 값을 맨 앞에 그대로 덧붙인다. 템플릿에서 선택지가 빠졌거나 계정 목록 밖 id 로
 * 저장해 두었어도 트리거가 빈칸이 되지 않게 한다(서버 withSavedModel 과 같은 규칙). 계정 모델 칸과 정적 select 칸이 함께 쓴다.
 */
export function withSavedOption(options: AgentTemplateOption[], saved: string | null | undefined): AgentTemplateOption[] {
  if (!saved?.trim() || options.some((o) => o.value === saved)) return options
  return [{ value: saved, label: saved }, ...options]
}

/** 모델 목록 조회 결과 중 이 함수가 보는 부분(react-query 결과와 같은 이름). */
export interface AgentModelsQuery {
  data: { provider: CredentialProvider; models: ModelOption[] } | undefined
  error: unknown
  isPending: boolean
}

/**
 * 「모델」 칸의 선택지·상태·도움말을 정한다.
 *
 * 1. 연결된 계정 종류가 템플릿 계정과 같고(그때만 조회한다) 목록이 비어 있지 않을 때만 실시간 목록을 쓴다 — 방식을 바꾸는 중이라 다른 계정이
 *    연결돼 있으면 조회하지 않고 otherAccount 로 알린다. 로그인 계정이 주는 빈 목록도 쓰지 않는다.
 * 2. 정적 선택지(별칭 「Opus(최신)」 등)를 맨 앞에, 이어 실시간 목록을 두고 value 가 겹치면 앞의 것만 남긴다(WP-1405 Q1 → A).
 * 3. 저장값이 선택지에 없으면 맨 앞에 그대로 덧붙인다 — 트리거가 빈칸이 되지 않게(서버 withSavedModel 과 같은 규칙).
 *
 * 서버가 안에서 정적 Anthropic 목록으로 폴백한 200 은 화면이 구분할 수 없다 — 그 목록도 계정이 쓸 수 있는 실제 id 라 live 로 둔다.
 */
export function modelFieldOptions({
  field,
  account,
  credential,
  query,
  saved,
}: {
  field: AgentTemplateConfigField
  account: CredentialProvider | null | undefined
  credential: AgentCredentialQuery
  query: AgentModelsQuery
  saved: string | null | undefined
}): { options: AgentTemplateOption[]; status: ModelOptionsStatus; hint: string | null } {
  const status = statusOf(account, credential, query)
  const live: AgentTemplateOption[] =
    status === 'live' ? (query.data?.models ?? []).map((m) => ({ value: m.id, label: m.label })) : []
  const options: AgentTemplateOption[] = []
  const seen = new Set<string>()
  for (const o of [...field.options, ...live]) {
    if (seen.has(o.value)) continue
    seen.add(o.value)
    options.push(o)
  }
  return { options: withSavedOption(options, saved), status, hint: hintOf(status, account) }
}

/**
 * 상태를 정한다 — 먼저 연결된 계정(없음 → noAccount, 다른 종류 → otherAccount, 아직 모름 → loading, 조회 실패 → failed),
 * 맞는 계정이면 모델 목록 조회 결과(404 → noAccount, 응답 계정이 다르면 otherAccount, 빈 목록·그 밖의 오류 → failed).
 */
function statusOf(
  account: CredentialProvider | null | undefined,
  credential: AgentCredentialQuery,
  query: AgentModelsQuery,
): ModelOptionsStatus {
  if (credential.provider === null) return 'noAccount'
  if (credential.provider === undefined) return credential.isPending ? 'loading' : 'failed'
  // 「이 계정이 이 방식에 맞는가」는 공용 규칙(accountFits) 하나로 본다 — 켜기 전 확인·확인 창과 같은 판정.
  const fits = (p: CredentialProvider) => accountFits(p, { mode: 'WORKSPACE', template: { account } })
  if (!fits(credential.provider)) return 'otherAccount'
  if (query.data) {
    // 조회와 연결 변경이 엇갈려 다른 계정의 목록이 왔으면 섞지 않는다.
    if (!fits(query.data.provider)) return 'otherAccount'
    return query.data.models.length > 0 ? 'live' : 'failed'
  }
  if (query.error) return apiErrorStatus(query.error) === 404 ? 'noAccount' : 'failed'
  return query.isPending ? 'loading' : 'failed'
}
