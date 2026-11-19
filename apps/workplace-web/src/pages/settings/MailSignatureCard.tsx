// 설정 › 메일 계정 「서명」 카드(WP-1517) — 사용자당 하나인 메일 서명을 만들고 자동으로 넣을 메일 종류를 고른다.
// Outlook 서명을 복사해 붙여 넣는 것이 주 경로라 안내문을 편집기 위에 둔다. 「비우기」는 편집기만 비우고, 서버 반영은 「저장」이 한다.
// 저장하면 서버가 정리한 HTML(이미지는 서명 이미지 경로로 바뀜)로 편집기를 갈아 끼우고, 가져오지 못한 이미지가 있으면 개수를 알린다.
// 다만 저장하는 동안 편집기·스위치를 더 고쳤으면 그 고친 값을 덮지 않는다(바뀜으로 남겨 다시 저장하게 한다).
// 표·인라인 style·글꼴·클래스 서식이 든 서명을 붙여 넣으면(WP-1726) 편집기 대신 「붙여넣은 서명 · 원본 그대로」 미리 보기로 바뀌고
// pasted=true 로 저장한다 — 원본 HTML 은 서버 정리만 거쳐 작성창·발송에 그대로 쓰인다. 다시 열어도 미리 보기로 열린다.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SettingsSection, SettingsToggleGroup, SettingsToggleRow } from '@/components/layout/SettingsSection';
import {
  MailSignatureEditor,
  type MailSignatureEditorHandle,
} from '@/components/mail/signature/MailSignatureEditor';
import { PastedSignaturePreview, type SignatureClipboard } from '@/components/mail/signature/PastedSignaturePreview';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useMailSignature, useUpdateMailSignature } from '@/hooks/queries/useMailSignature';
import { plainTextToMailHtml } from '@/lib/mailQuote';
import { toPastedSignatureHtml } from '@/lib/mailSignaturePaste';
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

/** 서명 카드 모드 — 편집기(tiptap) 또는 붙여넣은 서명 「원본 그대로」 미리 보기(WP-1726). */
type SignatureMode = 'editor' | 'pasted';

/**
 * 서명 편집 폼 — 처음 불러온 서명으로 한 번 마운트된다(그 뒤 서버 값은 저장 응답으로만 갈아 끼운다).
 * 「바뀜」은 모드, 모드별 지금 값과 기준값, 스위치 저장값으로 판정한다.
 * - 편집기: 편집기 출력 기준(baseline) — 서버 HTML 과 편집기 출력은 글자 단위로 다를 수 있다. 서버 값이 아닌 HTML 로 편집기를 열면
 *   (미리 보기에서 넘어옴) 기준이 없어(null) 저장할 것이 있는 상태다.
 * - 미리 보기: 서버가 붙여넣은 서명으로 저장했고(savedPasted) 그 HTML(savedHtml)과 같으면 바뀌지 않음.
 * 편집기는 편집기 모드일 때만 마운트한다 — 미리 보기에서 넘어올 때 editorSeed 로 새로 연다.
 */
function SignatureForm({ saved }: { saved: MailSignature }) {
  const update = useUpdateMailSignature();
  const editorRef = useRef<MailSignatureEditorHandle>(null);
  const [mode, setMode] = useState<SignatureMode>(saved.pasted ? 'pasted' : 'editor');
  const [savedPasted, setSavedPasted] = useState(saved.pasted);
  // 서버에 저장된 서명 HTML — 미리 보기에서 편집기로 돌아올 때 그 내용이 서버 값과 같은지 본다(같으면 「바뀜」이 아니다).
  const [savedHtml, setSavedHtml] = useState(saved.html);
  // 편집기 모드: 마운트할 때 넣을 내용, 편집기 지금 값과 기준값(서버 값으로 갈아 끼운 직후의 편집기 출력, 없으면 null).
  const [editorSeed, setEditorSeed] = useState(saved.pasted ? '' : saved.html);
  const [html, setHtml] = useState(saved.pasted ? '' : saved.html);
  const [baseline, setBaseline] = useState<string | null>(saved.pasted ? null : saved.html);
  // 편집기가 처음 알리는 값을 기준으로 삼을지 — 서버 값으로 연 편집기만 기준이 된다.
  const seedIsServer = useRef(!saved.pasted);
  // 미리 보기 모드: 그리는 HTML.
  const [pastedHtml, setPastedHtml] = useState(saved.pasted ? saved.html : '');
  const [autoNew, setAutoNew] = useState(saved.autoNew);
  const [autoReply, setAutoReply] = useState(saved.autoReply);
  const [savedFlags, setSavedFlags] = useState({ autoNew: saved.autoNew, autoReply: saved.autoReply });

  const isPasted = mode === 'pasted';
  // 지금 모드의 서명 값 — 저장 payload·「비우기」 판정에 쓴다.
  const current = isPasted ? pastedHtml : html;

  // 저장 응답이 올 때 「저장을 누른 뒤 더 고쳤는가」를 보려면 지금 값이 필요하다 — onSuccess 클로저의 state 는 누른 순간 값이라 ref 로 둔다.
  const latest = useRef({ html: current, pasted: isPasted, autoNew: saved.autoNew, autoReply: saved.autoReply });
  useEffect(() => {
    latest.current = { html: current, pasted: isPasted, autoNew, autoReply };
  }, [current, isPasted, autoNew, autoReply]);

  // 서명 내용이 서버와 다른가 — 모드가 서버와 다르면 늘 다르다.
  const contentDirty = isPasted
    ? !savedPasted || pastedHtml !== savedHtml
    : savedPasted || baseline === null || html !== baseline;
  const isDirty = contentDirty || autoNew !== savedFlags.autoNew || autoReply !== savedFlags.autoReply;

  const onEditorChange = (next: string, initial: boolean) => {
    setHtml(next);
    // 렌더를 기다리지 않고 ref 도 바로 새 값을 보게 한다 — 응답이 렌더 사이에 와도 고친 것을 놓치지 않게.
    latest.current = { ...latest.current, html: next };
    if (initial) setBaseline(seedIsServer.current ? next : null);
  };

  /** 붙여넣은 서명 미리 보기로 바꾼다(편집기·다시 붙여넣기에서 서식 있는 서명을 받았다). */
  const showPasted = (next: string) => {
    setPastedHtml(next);
    setMode('pasted');
    latest.current = { ...latest.current, html: next, pasted: true };
  };

  /**
   * 편집기 모드로 바꾸고 next 로 편집기를 연다. 그 내용이 서버 상태(편집기 서명 + 같은 HTML)와 같으면 「바뀌지 않음」 기준이 된다 —
   * 예: 빈 서명에 붙여넣은 서명을 넣었다가 「비우기」, 편집기 서명으로 같은 내용을 되돌림. fromServer 는 저장 응답으로 여는 경우.
   */
  const showEditor = (next: string, fromServer = false) => {
    seedIsServer.current = fromServer || (!savedPasted && next === savedHtml);
    setEditorSeed(next);
    setHtml(next);
    setBaseline(null);
    setMode('editor');
    latest.current = { ...latest.current, html: next, pasted: false };
  };

  /** 「다시 붙여넣기」 칸에 붙였다 — 서식 있는 서명이면 미리 보기를 바꾸고, 아니면 편집기로 넘어가 그 글을 넣는다. */
  const onRepaste = ({ html: pastedRaw, text }: SignatureClipboard) => {
    const pasted = toPastedSignatureHtml(pastedRaw);
    if (pasted !== null) showPasted(pasted);
    else showEditor(pastedRaw.trim() ? pastedRaw : plainTextToMailHtml(text));
  };

  /** 「비우기」 — 편집기 모드면 편집기만 비우고, 미리 보기면 빈 편집기로 돌아간다. 서버 반영은 「저장」이 한다. */
  const clear = () => {
    if (isPasted) showEditor('');
    else editorRef.current?.clear();
  };

  const save = () => {
    const sent = { html: current, autoNew, autoReply, pasted: isPasted };
    update.mutate(sent, {
      onSuccess: (res) => {
        const now = latest.current;
        if (now.html === sent.html && now.pasted === sent.pasted) {
          // 저장하는 동안 서명을 건드리지 않았다 — 서버가 정리한 HTML 로 갈아 끼운다.
          if (res.pasted) {
            setPastedHtml(res.html);
          } else if (sent.pasted) {
            // 원본 모드로 보냈지만 서버가 편집기 서명으로 저장했다(빈 서명) — 편집기로 연다.
            showEditor(res.html, true);
          } else {
            // 새 baseline 은 편집기가 initial 로 알린다.
            seedIsServer.current = true;
            editorRef.current?.reset(res.html);
          }
        } else if (!sent.pasted) {
          // 저장하는 동안 더 고쳤다 — 고친 내용을 덮지 않는다. 기준은 보낸 값(=서버에 저장된 내용)이라 지금 값은 바뀜으로 남는다.
          // (미리 보기는 아래 savedHtml 이 기준이라 따로 맞출 것이 없다.)
          setBaseline(sent.html);
        }
        setSavedPasted(res.pasted);
        setSavedHtml(res.html);
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
      {isPasted ? (
        <PastedSignaturePreview html={pastedHtml} onRepaste={onRepaste} onSwitchToEditor={() => showEditor(pastedHtml)} />
      ) : (
        <MailSignatureEditor ref={editorRef} initialHtml={editorSeed} onChange={onEditorChange} onRichPaste={showPasted} />
      )}

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
        <Button variant="outline" disabled={current === ''} onClick={clear}>
          비우기
        </Button>
        <Button disabled={!isDirty || update.isPending} onClick={save}>
          {update.isPending ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
