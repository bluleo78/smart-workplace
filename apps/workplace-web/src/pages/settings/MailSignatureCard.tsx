// 설정 › 메일 계정 「서명」 카드(WP-1517) — 사용자당 하나인 메일 서명을 만들고 자동으로 넣을 메일 종류를 고른다.
// Outlook 서명을 복사해 붙여 넣는 것이 주 경로라 안내문을 편집기 위에 둔다. 「비우기」는 편집기만 비우고, 서버 반영은 「저장」이 한다.
// 저장하면 서버가 정리한 HTML(이미지는 서명 이미지 경로로 바뀜)로 편집기를 갈아 끼우고, 가져오지 못한 이미지가 있으면 개수를 알린다.
// 다만 저장하는 동안 편집기·스위치를 더 고쳤으면 그 고친 값을 덮지 않는다(바뀜으로 남겨 다시 저장하게 한다).
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SettingsSection, SettingsToggleGroup, SettingsToggleRow } from '@/components/layout/SettingsSection';
import {
  MailSignatureEditor,
  type MailSignatureEditorHandle,
} from '@/components/mail/signature/MailSignatureEditor';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useMailSignature, useUpdateMailSignature } from '@/hooks/queries/useMailSignature';
import type { MailSignature } from '@/types/mailSignature';

/** 「서명」 카드 — 서명을 불러오는 동안은 편집기 자리 스켈레톤, 실패하면 다시 시도. */
export function MailSignatureCard() {
  const signature = useMailSignature();

  return (
    // 도움말 문맥(WP-1506) — 매뉴얼 12장 「메일 서명을 만든다」 절과 짝. 값은 글자 그대로 둔다(manual:check 가 소스에서 본다).
    <div data-help="mail-signature">
      <SettingsSection title="서명" data-testid="mail-signature-card">
        {signature.isPending ? (
          <Skeleton className="h-48 w-full max-w-3xl" data-testid="mail-signature-loading" />
        ) : signature.isError ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">서명을 불러오지 못했어요</p>
            <Button variant="outline" size="sm" onClick={() => void signature.refetch()}>
              다시 시도
            </Button>
          </div>
        ) : (
          <SignatureForm saved={signature.data} />
        )}
      </SettingsSection>
    </div>
  );
}

/**
 * 서명 편집 폼 — 처음 불러온 서명으로 한 번 마운트된다(그 뒤 서버 값은 저장 응답으로만 갈아 끼운다).
 * 「바뀜」은 편집기 출력 기준(baseline)과 스위치 저장값으로 판정한다 — 서버 HTML 과 편집기 출력은 글자 단위로 다를 수 있다.
 */
function SignatureForm({ saved }: { saved: MailSignature }) {
  const update = useUpdateMailSignature();
  const editorRef = useRef<MailSignatureEditorHandle>(null);
  // 편집기 지금 값과 기준값(마지막으로 갈아 끼운 직후의 편집기 출력).
  const [html, setHtml] = useState(saved.html);
  const [baseline, setBaseline] = useState(saved.html);
  const [autoNew, setAutoNew] = useState(saved.autoNew);
  const [autoReply, setAutoReply] = useState(saved.autoReply);
  const [savedFlags, setSavedFlags] = useState({ autoNew: saved.autoNew, autoReply: saved.autoReply });

  // 저장 응답이 올 때 「저장을 누른 뒤 더 고쳤는가」를 보려면 지금 값이 필요하다 — onSuccess 클로저의 state 는 누른 순간 값이라 ref 로 둔다.
  const latest = useRef({ html: saved.html, autoNew: saved.autoNew, autoReply: saved.autoReply });
  useEffect(() => {
    latest.current = { html, autoNew, autoReply };
  }, [html, autoNew, autoReply]);

  const isDirty = html !== baseline || autoNew !== savedFlags.autoNew || autoReply !== savedFlags.autoReply;

  const onEditorChange = (next: string, initial: boolean) => {
    setHtml(next);
    // 렌더를 기다리지 않고 ref 도 바로 새 값을 보게 한다 — 응답이 렌더 사이에 와도 고친 것을 놓치지 않게.
    latest.current = { ...latest.current, html: next };
    if (initial) setBaseline(next);
  };

  const save = () => {
    const sent = { html, autoNew, autoReply };
    update.mutate(sent, {
      onSuccess: (res) => {
        const now = latest.current;
        if (now.html === sent.html) {
          // 저장하는 동안 편집기를 건드리지 않았다 — 서버가 정리한 HTML 로 갈아 끼운다(새 baseline 은 편집기가 initial 로 알린다).
          editorRef.current?.reset(res.html);
        } else {
          // 저장하는 동안 더 고쳤다 — 고친 내용을 덮지 않는다. 기준은 보낸 값(=서버에 저장된 내용)이라 지금 값은 바뀜으로 남는다.
          setBaseline(sent.html);
        }
        // 스위치도 같은 규칙 — 그동안 바꾸지 않은 것만 서버 값으로 맞춘다. 저장값(savedFlags)은 언제나 서버 값.
        if (now.autoNew === sent.autoNew) setAutoNew(res.autoNew);
        if (now.autoReply === sent.autoReply) setAutoReply(res.autoReply);
        setSavedFlags({ autoNew: res.autoNew, autoReply: res.autoReply });
        if (res.droppedImageCount > 0) {
          // 서명은 저장됐지만 일부 이미지(file:·받기 실패·형식·크기 초과)는 빠졌다 — 직접 붙여 넣는 길을 알려 준다.
          toast.warning(`이미지 ${res.droppedImageCount}개를 가져오지 못해 뺐어요`, {
            description: '서명은 저장했어요. 이미지를 복사해 서명 칸에 직접 붙여 넣으세요',
          });
        } else {
          toast.success('서명을 저장했어요');
        }
      },
    });
  };

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Outlook 서명을 쓰려면 Outlook 의 <strong className="font-semibold text-foreground">설정 › 메일 › 서명</strong>에서 서명을
        모두 선택해 복사(Ctrl+C)한 뒤 아래에 붙여 넣으세요. 글꼴·색·로고 이미지·링크가 그대로 들어옵니다.
      </p>
      <MailSignatureEditor ref={editorRef} initialHtml={saved.html} onChange={onEditorChange} />

      <div className="space-y-3">
        <h3 className="text-sm font-medium">서명을 자동으로 넣을 메일</h3>
        <SettingsToggleGroup>
          <SettingsToggleRow
            label="새 메일"
            control={<Switch aria-label="새 메일" checked={autoNew} onCheckedChange={setAutoNew} />}
          />
          <SettingsToggleRow
            label="답장·전달"
            control={<Switch aria-label="답장·전달" checked={autoReply} onCheckedChange={setAutoReply} />}
          />
        </SettingsToggleGroup>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={html === ''} onClick={() => editorRef.current?.clear()}>
          비우기
        </Button>
        <Button disabled={!isDirty || update.isPending} onClick={save}>
          {update.isPending ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
