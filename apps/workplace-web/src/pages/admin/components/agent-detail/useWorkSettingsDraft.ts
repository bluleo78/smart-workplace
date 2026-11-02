// 「작업 설정」 초안(WP-1281) — 실행 › 작업 설정의 칸(방식이 정한 칸 + 실행 환경)과, 상태 섹션의 「저장하고 실행 시작」·「지금 적용」이 같은 값을 본다.
// 두 섹션이 떨어져 있어(상태 ↔ 실행) 초안을 상세 페이지 한곳에 두고 내려준다. 저장된 설정이 바뀌면(저장·다른 방식) 초안을 그 값으로 다시 채운다.

import { useState } from 'react';

import { configWithDefaults } from '../../../../lib/agentRuntimeStatus';
import type { AgentApplyMode, AgentRuntimeSetting, AgentTemplate, PutAgentRuntimeSettingRequest } from '../../../../types/agentRuntime';

/** 실행 환경 고르기의 「워크스페이스 기본」 값 — Select 는 빈 문자열을 값으로 못 쓴다. */
export const DEFAULT_LOCATION = 'default';

export interface WorkSettingsDraft {
  template: AgentTemplate;
  config: Record<string, string>;
  setField: (key: string, value: string) => void;
  locationValue: string;
  setLocationValue: (v: string) => void;
  /** 고른 실행 환경 id — null 이면 워크스페이스 기본. */
  locationId: number | null;
  /** 저장된 값과 다른지(저장 전 설정이면 늘 참). */
  dirty: boolean;
  /** 바뀐 칸 이름 — 「저장하지 않은 변경이 있어요(모델)」에 쓴다. */
  dirtyLabels: string[];
  missingRequired: boolean;
  /** 저장 요청 본문. */
  body: (applyMode?: AgentApplyMode) => PutAgentRuntimeSettingRequest;
  /** 초안을 저장된 값으로 되돌린다. */
  reset: () => void;
}

/** 저장된 설정(없으면 방식 기본값)으로 초안 시작 값을 만든다. */
function initial(template: AgentTemplate, saved: AgentRuntimeSetting | null) {
  return {
    config: configWithDefaults(template, saved?.config),
    locationValue: saved?.locationId != null ? String(saved.locationId) : DEFAULT_LOCATION,
  };
}

/**
 * template 이 null 이면(작업 공간 방식이 아님) null. saved 는 이 방식으로 저장된 설정 — 아직 저장 전(방식 바꾸기 중)이면 null.
 */
export function useWorkSettingsDraft(template: AgentTemplate | null, saved: AgentRuntimeSetting | null): WorkSettingsDraft | null {
  // 저장된 값이 바뀌었는지 알아보는 열쇠 — 저장하면 generation 이 오르고, 방식이 바뀌면 이름이 바뀐다.
  const baseKey = `${template?.name ?? ''}:${saved?.templateName ?? ''}:${saved?.generation ?? 'new'}`;
  const [state, setState] = useState(() => (template ? initial(template, saved) : null));
  const [prevKey, setPrevKey] = useState(baseKey);
  // 렌더 중 상태 조정(React 공식 패턴) — 저장된 값이 바뀌면 초안을 새로 채운다.
  if (prevKey !== baseKey) {
    setPrevKey(baseKey);
    setState(template ? initial(template, saved) : null);
  }
  if (!template || !state) return null;

  const locationId = state.locationValue === DEFAULT_LOCATION ? null : Number(state.locationValue);
  const savedConfig = saved ? configWithDefaults(template, saved.config) : null;
  const dirtyLabels = [
    ...template.config.filter((f) => (savedConfig?.[f.key] ?? '') !== (state.config[f.key] ?? '')).map((f) => f.label),
    ...((saved?.locationId ?? null) !== locationId ? ['실행 환경'] : []),
  ];
  return {
    template,
    config: state.config,
    setField: (key, value) => setState((s) => (s ? { ...s, config: { ...s.config, [key]: value } } : s)),
    locationValue: state.locationValue,
    setLocationValue: (v) => setState((s) => (s ? { ...s, locationValue: v } : s)),
    locationId,
    dirty: saved == null || dirtyLabels.length > 0,
    dirtyLabels,
    missingRequired: template.config.some((f) => f.required && !state.config[f.key]),
    body: (applyMode) => ({ templateName: template.name, locationId, config: state.config, applyMode }),
    reset: () => setState(initial(template, saved)),
  };
}
