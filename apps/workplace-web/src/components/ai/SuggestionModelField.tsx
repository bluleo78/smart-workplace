// 추천 질문 모델 선택(WP-139) — 개인 비서 카드·관리자 에이전트 상세가 같이 쓴다. 목록 조회를 지원하지 않는 연결은
// 비서 모델 항목처럼 현재 값 표시 + 직접 입력으로 대체한다. 저장은 호출측(onChange: null=자동).
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AUTO_SELECT_VALUE, suggestionModelChoices, withProviderPrefix } from '@/lib/ai/suggestionModel';
import type { ModelOption } from '@/types/providerCredential';

interface Props {
  /** label htmlFor·testid 접두(예: 'assistant-suggestion-model'). */
  id: string;
  /** 상태 응답의 suggestionModelAuto — "자동 (…)" 라벨(API 가 정한 실제 모델). */
  autoModel: string | null | undefined;
  /** 저장된 값(null=자동). */
  value: string | null | undefined;
  options: ModelOption[];
  loading: boolean;
  saving: boolean;
  /** 직접 입력 시 접두가 없으면 붙일 providerId(opencode) — 비서 모델 직접 입력과 같은 규칙. 모르면 입력 그대로. */
  providerId?: string;
  onChange: (value: string | null) => void;
}

export function SuggestionModelField({ id, autoModel, value, options, loading, saving, providerId, onChange }: Props) {
  const [manual, setManual] = useState('');
  const choices = suggestionModelChoices({ autoModel, value, options });
  const current = value ?? AUTO_SELECT_VALUE;
  const currentLabel = choices.find((c) => c.id === current)?.label ?? value ?? '';

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={id}>
        추천 질문 모델
      </label>
      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : options.length > 0 ? (
        <Select value={current} onValueChange={(v) => onChange(v === AUTO_SELECT_VALUE ? null : v)} disabled={saving}>
          <SelectTrigger id={id} data-testid={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <p className="text-sm" data-testid={`${id}-current`}>
            현재: {currentLabel}
          </p>
          <div className="flex gap-2">
            <Input
              id={id}
              data-testid={`${id}-input`}
              placeholder={providerId ? `${providerId}/model-id` : '모델 id'}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <Button
              data-testid={`${id}-apply`}
              disabled={!manual.trim() || saving}
              onClick={() => {
                onChange(withProviderPrefix(manual, providerId));
                setManual('');
              }}
            >
              변경
            </Button>
            {value ? (
              <Button variant="outline" data-testid={`${id}-auto`} disabled={saving} onClick={() => onChange(null)}>
                자동으로
              </Button>
            ) : null}
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">추천·후속 질문을 만들 때만 쓰는 가벼운 모델이에요.</p>
    </div>
  );
}
