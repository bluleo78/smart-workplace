// 작업 설정 칸(WP-1281) — 방식이 정한 칸(모델·대기열 라벨 등) + 실행 환경. 칸 설명·자원 안내는 설정 가이드(agentDetailGuide)에 있다.
// 「실행 › 작업 설정」 묶음과, 다른 방식에서 이 방식으로 바꿀 때 펼치는 칸이 함께 쓴다. 칸은 방식 정의대로 그린다 — 이 화면은 방식 이름을 모른다.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useAgentLocations } from '../../../../hooks/queries/useAgentRuntime';
import { locationOptionLabel } from '../../../../lib/agentRuntimeStatus';
import { DEFAULT_LOCATION, type WorkSettingsDraft } from './useWorkSettingsDraft';

export function WorkSettingsFields({ draft, idPrefix = 'rt' }: { draft: WorkSettingsDraft; idPrefix?: string }) {
  const locations = useAgentLocations();
  const defaultLocation = locations.data?.find((l) => l.isDefault) ?? null;
  return (
    <div className="space-y-2" data-testid="agent-work-settings">
      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {draft.template.config.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</Label>
            {f.type === 'select' ? (
              <Select value={draft.config[f.key] ?? ''} onValueChange={(v) => draft.setField(f.key, v)}>
                <SelectTrigger id={`${idPrefix}-${f.key}`} className="w-full" data-testid={`agent-runtime-config-${f.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
