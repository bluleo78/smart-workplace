// 작업 공간 템플릿 AI 의 상태·설정(WP-1254) — 상태 카드(켜고 끄기·다시 시작) + 템플릿이 정한 설정 칸 + 실행 위치 + 맡는 프로젝트.
// 칸은 템플릿 config 정의대로 그린다 — 이 화면은 템플릿 이름을 모른다. 켜져 있을 때 바꾼 설정은 「다음 대기 때 적용」.

import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';

import { useAgentProviderCredentialMeta } from '../../../hooks/queries/useAgentProviderCredential';
import {
  useAgentLocations,
  useAgentRuntimeAction,
  useAgentRuntimeProjects,
  useSaveAgentRuntimeSetting,
} from '../../../hooks/queries/useAgentRuntime';
import {
  configWithDefaults,
  formatCpu,
  formatMemory,
  formatUptime,
  freeSeats,
  isRunningStatus,
  locationOptionLabel,
  statusDetail,
  statusPill,
  templateResourceText,
} from '../../../lib/agentRuntimeStatus';
import { issuePath } from '../../../lib/appUrl';
import { parseIssueKeyQuery } from '../../../lib/sendToChat';
import { cn } from '../../../lib/utils';
import type { AgentRuntimeSetting, AgentTemplate } from '../../../types/agentRuntime';
import { ProviderCredentialDialog } from './ProviderCredentialDialog';

// 위치 고르기의 「워크스페이스 기본」 값 — Select 는 빈 문자열을 값으로 못 쓴다.
const DEFAULT_LOCATION = 'default';

/** 「WD-319」 → 이슈 상세 경로. 형식이 아니면 null. */
function issueKeyPath(key: string): string | null {
  const k = parseIssueKeyQuery(key);
  return k ? issuePath(k.projectKey, k.number) : null;
}

interface Props {
  agentId: number;
  template: AgentTemplate;
  /** 이 템플릿으로 저장된 설정 — 아직 저장 전(카드만 고름)이면 null. */
  saved: AgentRuntimeSetting | null;
  /** 저장 전 선택을 취소(이전 템플릿으로). 저장된 설정이면 없음. */
  onCancelDraft?: () => void;
  onSaved: () => void;
}

export function AgentWorkspaceRuntime({ agentId, template, saved, onCancelDraft, onSaved }: Props) {
  const locations = useAgentLocations();
  const projects = useAgentRuntimeProjects(agentId);
  const credential = useAgentProviderCredentialMeta(agentId);
  const save = useSaveAgentRuntimeSetting(agentId);
  const action = useAgentRuntimeAction(agentId);
  const [credentialOpen, setCredentialOpen] = useState(false);

  const [config, setConfig] = useState(() => configWithDefaults(template, saved?.config));
  const [locationValue, setLocationValue] = useState(() =>
    saved?.locationId != null ? String(saved.locationId) : DEFAULT_LOCATION,
  );
  const locationId = locationValue === DEFAULT_LOCATION ? null : Number(locationValue);
  const savedConfig = saved ? configWithDefaults(template, saved.config) : null;
  const dirty =
    saved == null ||
    (saved.locationId ?? null) !== locationId ||
    template.config.some((f) => (savedConfig?.[f.key] ?? '') !== (config[f.key] ?? ''));
  const missingRequired = template.config.some((f) => f.required && !config[f.key]);

  const status = saved?.status ?? 'OFF';
  const running = isRunningStatus(status);
  // 단추·확인 항목을 고르는 모드. 원하는 상태가 RUN 인데 실패면 자리는 이미 잡혀 있어 확인 없이 「다시 켜기」·「끄기」.
  const mode: 'running' | 'failedOn' | 'stopping' | 'off' = running
    ? 'running'
    : status === 'FAILED' && saved?.desired === 'RUN'
      ? 'failedOn'
      : status === 'STOPPING'
        ? 'stopping'
        : 'off';
  const pill = statusPill(status, saved?.observed?.agentState);
  const detail = saved
    ? statusDetail({
        status,
        agentState: saved.observed?.agentState,
        agentIssueKey: saved.observed?.agentIssueKey,
        agentNextCheckAt: saved.observed?.agentNextCheckAt,
        message: saved.observed?.message,
      })
    : null;
  const detailPath = detail?.kind === 'issue' ? issueKeyPath(detail.text) : null;

  // 켜기 전 확인 — Claude 연결(이 AI 의 AI 연결이 Claude 구독인지)·실행 위치 자리. 저장소는 위치에 둔 토큰이라 Works 가 판정하지 못해 프로젝트 수만 보인다.
  const defaultLocation = locations.data?.find((l) => l.isDefault) ?? null;
  const targetLocation = locationId == null ? defaultLocation : (locations.data?.find((l) => l.id === locationId) ?? null);
  const needsClaude = template.requires.includes('claude');
  const claudeOk = !needsClaude || credential.data?.provider === 'anthropic';
  const seatOk = targetLocation != null && freeSeats(targetLocation) > 0;
  const resourceText = templateResourceText(template);

  const body = (applyMode?: 'NOW') => ({ templateName: template.name, locationId, config, applyMode });
  // 저장 — 켜져 있으면 쉴 때 반영(IDLE). 처음 저장이면 실행 방식이 작업 공간으로 바뀐다.
  const onSave = () => save.mutate(body(), { onSuccess: onSaved });
  // 켜기 — 바뀐 설정이 있으면 먼저 저장하고 켠다.
  const onStart = () => {
    if (dirty) save.mutate(body(), { onSuccess: () => { onSaved(); action.mutate('start'); } });
    else action.mutate('start');
  };
  // 실패한 채 켜져 있으면 — 바뀐 설정은 NOW 로 저장해 바로 다시 만들고(실패한 Pod 는 쉬는 중이 아니다), 아니면 켜기(서버가 다시 만든다).
  const onRetry = () => {
    if (dirty) save.mutate(body('NOW'), { onSuccess: onSaved });
    else action.mutate('start');
  };
  // 지금 적용 — 같은 설정을 NOW 로 다시 보내 작업 중이어도 바로 다시 만든다.
  const onApplyNow = () => save.mutate(body('NOW'));
  const pending = save.isPending || action.isPending;

  return (
    <div className="space-y-4" data-testid="agent-workspace-runtime">
      {/* 상태 카드 — 저장된 설정이 있을 때만. 꺼져 있으면 확인 항목과 「켜기」. */}
      <section className="space-y-3 rounded-md border p-4" data-testid="agent-runtime-status-card">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium">상태</h4>
          <StatusBadge type={pill.type} data-testid="agent-runtime-status">
            {pill.label}
          </StatusBadge>
          {detail &&
            (detailPath ? (
              <Link to={detailPath} className="font-mono text-xs text-primary hover:underline" data-testid="agent-runtime-detail">
                {detail.text}
              </Link>
            ) : (
              <span
                className={cn('text-xs', detail.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}
                data-testid="agent-runtime-detail"
              >
                {detail.text}
              </span>
            ))}
          {saved?.effectiveLocation && (
            <span className="ml-auto text-xs text-muted-foreground">{saved.effectiveLocation.name}</span>
          )}
        </div>

        {running && saved?.observed && (
          <dl className="grid grid-cols-3 gap-2" data-testid="agent-runtime-stats">
            {[
              ['CPU', formatCpu(saved.observed.cpuMillicores)],
              ['메모리', formatMemory(saved.observed.memoryBytes, template.resources?.memoryLimit)],
              ['켜진 시간', formatUptime(saved.observed.startedAt, new Date())],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="truncate text-sm font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {status === 'APPLY_PENDING' && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-foreground"
            data-testid="agent-runtime-apply-pending"
          >
            <span className="flex-1">바뀐 설정은 이 AI 가 하던 일을 마치고 쉴 때 적용됩니다.</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={onApplyNow} data-testid="agent-runtime-apply-now">
              지금 적용
            </Button>
          </div>
        )}

        {mode === 'off' && (
          <ul className="space-y-1.5 text-sm" data-testid="agent-runtime-checks">
            {needsClaude && (
              <li className="flex items-center gap-2">
                <CheckMark ok={claudeOk} />
                <span className="flex-1">Claude 연결</span>
                {!claudeOk && (
                  <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setCredentialOpen(true)}>
                    {credential.data ? '바꾸기' : '연결하기'}
                  </Button>
                )}
              </li>
            )}
            <li className="flex items-center gap-2">
              <CheckMark ok={seatOk} />
              <span className="flex-1">
                실행 자리{' '}
                <span className="text-xs text-muted-foreground">
                  {targetLocation ? locationOptionLabel(targetLocation, false) : '실행 위치가 없습니다'}
                  {resourceText ? ` · ${resourceText}` : ''}
                </span>
              </span>
              {!targetLocation && (
                <Link to="/settings/agent-locations" className="text-xs text-primary hover:underline">
                  위치 추가
                </Link>
              )}
            </li>
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {mode === 'running' && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => action.mutate('restart')} data-testid="agent-runtime-restart">
                다시 시작
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => action.mutate('stop')} data-testid="agent-runtime-stop">
                끄기
              </Button>
            </>
          )}
          {mode === 'failedOn' && (
            <>
              <Button size="sm" disabled={pending || missingRequired} onClick={onRetry} data-testid="agent-runtime-start">
                다시 켜기
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => action.mutate('stop')} data-testid="agent-runtime-stop">
                끄기
              </Button>
            </>
          )}
          {mode === 'off' && (
            <Button
              size="sm"
              disabled={pending || !claudeOk || !seatOk || missingRequired}
              onClick={onStart}
              data-testid="agent-runtime-start"
            >
              켜기
            </Button>
          )}
        </div>
      </section>

      {/* 설정 — 템플릿이 정한 칸 + 실행 위치. */}
      <section className="space-y-3" data-testid="agent-runtime-config">
        <h4 className="text-xs font-medium text-muted-foreground">설정</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {template.config.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`rt-${f.key}`}>{f.label}</Label>
              {f.type === 'select' ? (
                <Select value={config[f.key] ?? ''} onValueChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))}>
                  <SelectTrigger id={`rt-${f.key}`} className="w-full" data-testid={`agent-runtime-config-${f.key}`}>
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
                  id={`rt-${f.key}`}
                  value={config[f.key] ?? ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                  data-testid={`agent-runtime-config-${f.key}`}
                />
              )}
            </div>
          ))}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rt-location">실행 위치</Label>
            <Select value={locationValue} onValueChange={setLocationValue}>
              <SelectTrigger id="rt-location" className="w-full" data-testid="agent-runtime-location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_LOCATION}>
                  워크스페이스 기본{defaultLocation ? ` (${defaultLocation.name}) · 남은 자리 ${freeSeats(defaultLocation)}` : ''}
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
        {(dirty || onCancelDraft) && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={pending || missingRequired || !dirty} onClick={onSave} data-testid="agent-runtime-save">
              저장
            </Button>
            {onCancelDraft && (
              <Button size="sm" variant="ghost" onClick={onCancelDraft}>
                취소
              </Button>
            )}
            {running && dirty && <span className="text-xs text-muted-foreground">다음 대기 때 적용</span>}
          </div>
        )}
      </section>

      {/* 맡는 프로젝트 — 고르지 않는다. 이 AI 가 멤버이고 저장소가 연결된 프로젝트. */}
      <section className="space-y-2" data-testid="agent-runtime-projects">
        <h4 className="text-xs font-medium text-muted-foreground">맡는 프로젝트</h4>
        {projects.data && projects.data.length > 0 ? (
          <ul className="space-y-1.5">
            {projects.data.map((p) => (
              <li key={p.projectKey} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">{p.projectKey}</span>
                <span className="truncate">{p.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {repoName(p.repositoryUrl)}
                  {p.repositoryBranch ? ` (${p.repositoryBranch})` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">맡는 프로젝트가 없어요.</p>
        )}
        <p className="text-xs text-muted-foreground">
          이 AI 가 멤버이고 저장소가 연결된 프로젝트입니다. 프로젝트 멤버로 넣거나 빼면 바뀌고, 다음 시작 때 반영됩니다.
        </p>
      </section>

      <ProviderCredentialDialog
        open={credentialOpen}
        onOpenChange={setCredentialOpen}
        agentUserId={agentId}
        isReissue={credential.data != null}
      />
    </div>
  );
}

/** 확인 항목 표시 — 통과 ✓(성공 색), 아니면 ✗(경고 색). */
function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="size-4 shrink-0 text-success" aria-label="통과" />
  ) : (
    <X className="size-4 shrink-0 text-warning" aria-label="필요" />
  );
}

/** 저장소 주소 → 「owner/name」. */
function repoName(url: string | null): string {
  if (!url) return '';
  const m = /([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : url;
}
