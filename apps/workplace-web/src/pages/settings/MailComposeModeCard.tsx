// 설정 › 메일 계정 「작성 방식」 카드(WP-1744) — 새 메일·답장·전달·임시보관함 다시 열기를 어디서 열지(읽기 창 / 우측 하단 / 새 창) 고른다.
// 고르는 즉시 서버에 저장한다(낙관적 갱신 — 실패하면 이전 값으로 돌아오고 오류 토스트). 작성창 위 단추(WP-1743)로 그때그때 옮기는 것은 그대로다.
// 모양은 디자인 시스템의 라디오 카드(Label + RadioGroupItem, 고른 카드 테두리 border-primary — PersonalAssistantSection 과 같은 패턴).
import { useId } from 'react';

import { SettingsSection } from '@/components/layout/SettingsSection';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useMailSettings, useUpdateMailSettings } from '@/hooks/queries/useMailSettings';
import type { MailComposeDefault } from '@/types/mailSettings';

/** 고를 수 있는 작성 방식 — 화면 순서(읽기 창 → 우측 하단 → 새 창)와 문구. */
const OPTIONS: { value: MailComposeDefault; title: string; description: string }[] = [
  { value: 'PANE', title: '읽기 창', description: '메일 화면 오른쪽에서 바로 작성' },
  { value: 'DOCK', title: '우측 하단', description: '작은 창으로 띄우고 목록을 계속 보기' },
  { value: 'WINDOW', title: '새 창', description: '브라우저 새 창으로 열기' },
];

const isComposeDefault = (v: string): v is MailComposeDefault => OPTIONS.some((o) => o.value === v);

/** 「작성 방식」 카드 — 불러오는 동안은 카드 자리 스켈레톤, 실패하면 다시 시도. */
export function MailComposeModeCard() {
  const settings = useMailSettings();
  const update = useUpdateMailSettings();
  const baseId = useId();

  // 상태별 본문 — 불러오는 중 → 실패 → 선택지 순으로 이른 return.
  const renderBody = () => {
    if (settings.isPending) return <Skeleton className="h-16 w-full max-w-3xl" data-testid="mail-compose-mode-loading" />;
    if (settings.isError) {
      return (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">작성 방식을 불러오지 못했어요</p>
          <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
            다시 시도
          </Button>
        </div>
      );
    }
    return (
      <RadioGroup
        aria-label="작성 방식"
        value={settings.data.composeMode}
        onValueChange={(v) => {
          // 지금 값과 같으면 저장하지 않는다 — 고르는 즉시 저장이라 같은 값 PUT 을 보내지 않게.
          if (isComposeDefault(v) && v !== settings.data.composeMode) update.mutate({ composeMode: v });
        }}
        className="grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {OPTIONS.map((o) => {
          const itemId = `${baseId}-${o.value}`;
          return (
            <Label
              key={o.value}
              htmlFor={itemId}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm font-normal has-[[data-state=checked]]:border-primary"
            >
              {/* 이름은 제목, 설명은 aria-describedby — 화면 낭독기가 「읽기 창, 라디오」 다음에 설명을 읽는다. */}
              <RadioGroupItem
                id={itemId}
                value={o.value}
                aria-labelledby={`${itemId}-title`}
                aria-describedby={`${itemId}-desc`}
                data-testid={`mail-compose-mode-${o.value.toLowerCase()}`}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span id={`${itemId}-title`} className="block font-medium">
                  {o.title}
                </span>
                <span id={`${itemId}-desc`} className="block text-muted-foreground">
                  {o.description}
                </span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    );
  };

  return (
    // 도움말 문맥: 매뉴얼 12장 「작성 방식」 절(help=mail-compose-mode)과 짝 — manual:check 가 소스에서 글자 그대로 짝을 본다.
    <SettingsSection
      data-help="mail-compose-mode"
      title="작성 방식"
      description="새 메일·답장·전달을 열 곳. 작성창 위 단추로 그때그때 바꿀 수 있어요."
      data-testid="mail-compose-mode-card"
    >
      {renderBody()}
    </SettingsSection>
  );
}
