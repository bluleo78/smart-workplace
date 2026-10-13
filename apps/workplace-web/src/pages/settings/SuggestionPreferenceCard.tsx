// 설정 > AI 비서 맨 위 "추천 질문" 카드(WP-139, 시안 A) — 알림 설정과 같은 스위치 행. 개인 비서 유무와 관계없이 보인다.
// 스위치는 채팅 패널이 보는 것과 같은 설정 쿼리 캐시를 갱신하므로 새로고침 없이 추천 UI 가 숨고 나타난다.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAiPreferences, useUpdateAiPreferences } from '@/hooks/queries/useAiPreferences';

export function SuggestionPreferenceCard() {
  const prefs = useAiPreferences();
  const update = useUpdateAiPreferences();
  return (
    <Card data-testid="ai-suggestions-card">
      <CardHeader>
        <CardTitle>추천 질문</CardTitle>
        <CardDescription>AI 대화에서 시작할 질문과 답 뒤 이어 물을 질문을 제안해요.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">추천 질문 보기</p>
            <p className="text-xs text-muted-foreground">빈 대화의 추천 질문과 답변 뒤 후속 질문</p>
          </div>
          <Switch
            data-testid="ai-suggestions-toggle"
            checked={prefs.data?.suggestionsEnabled ?? true}
            // 응답 전 연타로 요청 순서가 엇갈리지 않게 저장 중엔 잠근다(알림 설정과 같은 이유).
            disabled={!prefs.isSuccess || update.isPending}
            onCheckedChange={(v) => update.mutate({ suggestionsEnabled: v })}
            aria-label="추천 질문 보기"
          />
        </div>
      </CardContent>
    </Card>
  );
}
