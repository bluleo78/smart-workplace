// 작업 설정 칸(WP-1281) — 방식이 정한 칸(모델·대기열 라벨 등) + 실행 환경. 칸 설명·자원 안내는 설정 가이드(agentDetailGuide)에 있다.
// 「실행 › 작업 설정」 묶음과, 다른 방식에서 이 방식으로 바꿀 때 펼치는 칸이 함께 쓴다. 칸은 방식 정의대로 그린다 — 이 화면은 방식 이름을 모른다.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useAgentProviderCredentialMeta } from '../../../../hooks/queries/useAgentProviderCredential';
import { useAgentLocations } from '../../../../hooks/queries/useAgentRuntime';
import { useAgentModels } from '../../../../hooks/queries/useAssistant';
import { accountFits } from '../../../../lib/agentAccount';
import { modelFieldOptions, withSavedOption } from '../../../../lib/agentModelOptions';
import { locationOptionLabel } from '../../../../lib/agentRuntimeStatus';
import type { AgentTemplateConfigField, AgentTemplateOption } from '../../../../types/agentRuntime';
import { DEFAULT_LOCATION, type WorkSettingsDraft } from './useWorkSettingsDraft';

/**
 * 작업 설정 칸 묶음.
 *
 * @param agentId 이 AI 의 id — 선택지를 계정 모델 목록에서 채우는 칸(optionsFrom: account-models, WP-1405)이 그 AI 의 모델 목록을 조회할 때 쓴다
 */
export function WorkSettingsFields({ draft, agentId, idPrefix = 'rt' }: { draft: WorkSettingsDraft; agentId: number; idPrefix?: string }) {
  const locations = useAgentLocations();
  const defaultLocation = locations.data?.find((l) => l.isDefault) ?? null;
  return (
    <div className="space-y-2" data-testid="agent-work-settings">
      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {draft.template.config.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</Label>
            {f.type === 'select' ? (
              f.optionsFrom === 'account-models' ? (
                <AccountModelSelect field={f} draft={draft} agentId={agentId} id={`${idPrefix}-${f.key}`} />
              ) : (
                <FieldSelect field={f} draft={draft} id={`${idPrefix}-${f.key}`} options={f.options} />
              )
            ) : (
              <Input
                id={`${idPrefix}-${f.key}`}
                value={draft.config[f.key] ?? ''}
                onChange={(e) => draft.setField(f.key, e.target.value)}
                data-testid={`agent-runtime-config-${f.key}`}
              />
            )}
          </div>
        ))}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-location`}>실행 환경</Label>
          <Select value={draft.locationValue} onValueChange={draft.setLocationValue}>
            <SelectTrigger id={`${idPrefix}-location`} className="w-full" data-testid="agent-runtime-location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_LOCATION}>
                워크스페이스 기본{defaultLocation ? ` (${locationOptionLabel(defaultLocation, false)})` : ''}
              </SelectItem>
              {(locations.data ?? []).map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {locationOptionLabel(l)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

/**
 * select 칸 한 개 — 주어진 선택지로 그린다. 값은 초안(draft.config)에 둔다. 저장값이 선택지에 없으면(템플릿에서 빠진 선택지 등) 맨 앞에 덧붙여
 * 트리거가 빈칸이 되지 않게 한다(withSavedOption — 계정 모델 칸과 같은 규칙).
 */
function FieldSelect({ field, draft, id, options }: { field: AgentTemplateConfigField; draft: WorkSettingsDraft; id: string; options: AgentTemplateOption[] }) {
  const value = draft.config[field.key] ?? '';
  return (
    <Select value={value} onValueChange={(v) => draft.setField(field.key, v)}>
      <SelectTrigger id={id} className="w-full" data-testid={`agent-runtime-config-${field.key}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {withSavedOption(options, value).map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * 계정 모델 칸(WP-1405) — 그 AI 에 연결된 계정의 모델 목록을 받아 정적 별칭 뒤에 붙여 보인다. 조회 중·실패여도 정적 선택지로 고를 수 있게
 * 막지 않고, 상태는 칸 아래 한 줄로 알린다. 선택지만 바뀌고 초안 값은 건드리지 않아 목록이 늦게 와도 「저장하지 않은 변경」이 생기지 않는다.
 * 모델 목록은 AI 계정 묶음과 같은 쿼리키라 캐시를 나눠 쓰고, 연결을 바꾸면 함께 새로 받는다.
 */
function AccountModelSelect({ field, draft, agentId, id }: { field: AgentTemplateConfigField; draft: WorkSettingsDraft; agentId: number; id: string }) {
  const account = draft.template.account;
  // 연결된 계정 종류가 이 방식의 계정과 같을 때만 모델 목록을 부른다 — 다르면(방식 바꾸는 중 등) 서버가 그 계정의 목록(예: OpenAI 호환 프로브)을
  // 돌리고, 그 실패가 「불러오지 못해」로 잘못 보이기 때문이다. 연결 조회는 AI 계정 묶음·방식 바꾸기 확인 창과 같은 훅(같은 캐시)이다.
  const credential = useAgentProviderCredentialMeta(agentId);
  const connected = credential.data === undefined ? undefined : (credential.data?.provider ?? null);
  const fits = connected != null && accountFits(connected, { mode: 'WORKSPACE', template: draft.template });
  const models = useAgentModels(fits ? agentId : null);
  const { options, hint } = modelFieldOptions({
    field,
    account,
    credential: { provider: connected, isPending: credential.isPending },
    query: { data: models.data, error: models.error, isPending: models.isPending },
    saved: draft.config[field.key],
  });
  return (
    <>
      <FieldSelect field={field} draft={draft} id={id} options={options} />
      {hint && (
        <p className="text-xs text-muted-foreground" data-testid={`agent-runtime-config-${field.key}-hint`}>
          {hint}
        </p>
      )}
    </>
  );
}
