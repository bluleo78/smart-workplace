// 채팅 서식 도구(WP-101, 「A안」) — 입력창 왼쪽 「Aa」 토글과, 열면 입력창 위에 나오는 서식 버튼 줄.
// 버튼은 에디터 포커스를 빼앗지 않는다(keepFocusProps — 누를 때 iOS 키보드가 내려가지 않게, WP-224). 켜진 서식은 aria-pressed 로 표시.
// 모바일(한 줄 입력)은 줄이 넘치면 가로로 스크롤한다. 링크만 주소 입력 팝오버가 포커스를 가져간다(입력칸이 키보드를 이어받는다).
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  SquareCode,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { safeHref } from '@/components/mentions/chatMarkdown';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeLinkInput } from '@/components/wiki/wikiLinkUrl';
import { keepFocusProps } from '@/lib/keepFocus';
import { ghostToggleClass } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

/** 단축키 표기 — macOS 계열은 ⌘, 그 밖은 Ctrl+. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const SHIFT = MOD === '⌘' ? '⇧' : 'Shift+';

interface FormatAction {
  key: string;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  isActive: (e: Editor) => boolean;
  run: (e: Editor) => void;
}

/** 버튼 묶음 — 묶음 사이에 구분선. 순서: 글자 꾸밈 | 코드 | 목록 (그 뒤 링크). */
const GROUPS: FormatAction[][] = [
  [
    { key: 'bold', label: '굵게', shortcut: `${MOD}B`, icon: Bold, isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
    { key: 'italic', label: '기울임', shortcut: `${MOD}I`, icon: Italic, isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
    { key: 'underline', label: '밑줄', shortcut: `${MOD}U`, icon: Underline, isActive: (e) => e.isActive('underline'), run: (e) => e.chain().focus().toggleUnderline().run() },
    { key: 'strike', label: '취소선', shortcut: `${MOD}${SHIFT}S`, icon: Strikethrough, isActive: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  ],
  [
    { key: 'code', label: '인라인 코드', shortcut: `${MOD}E`, icon: Code, isActive: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
    { key: 'codeBlock', label: '코드 블록', shortcut: `${MOD}${MOD === '⌘' ? '⌥' : 'Alt+'}C`, icon: SquareCode, isActive: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
  ],
  [
    { key: 'bulletList', label: '글머리 목록', shortcut: `${MOD}${SHIFT}8`, icon: List, isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: 'orderedList', label: '번호 목록', shortcut: `${MOD}${SHIFT}7`, icon: ListOrdered, isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  ],
];

/** 서식 버튼 공통 모양 — 데스크톱 32px, 모바일 44px 터치 타깃. */
const BUTTON_CLASS = 'size-8 shrink-0 text-muted-foreground hover:text-foreground max-lg:size-11 [&_svg]:size-4 max-lg:[&_svg]:size-5';

/**
 * 「Aa」 토글 — 서식 도구 줄 여닫기. 입력창 왼쪽 ＋ 옆. 열림 상태는 호출처(RichInput)가 기기별로 기억한다(usePersistentToggle).
 */
export function ChatFormatToggle({ open, onToggle, testId }: { open: boolean; onToggle: () => void; testId: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={open ? '서식 도구 닫기' : '서식 도구 열기'}
      title="서식"
      aria-pressed={open}
      aria-controls={`${testId}-toolbar`}
      data-testid={testId}
      onClick={onToggle}
      {...keepFocusProps}
      className={cn(
        'text-sm font-semibold text-foreground/70 hover:text-foreground max-lg:size-11 max-lg:rounded-full',
        ghostToggleClass(open),
      )}
    >
      Aa
    </Button>
  );
}

/** 서식 버튼 줄. role=toolbar. 켜진 서식은 에디터 상태(useEditorState)로 바로 반영된다. */
export function ChatFormatToolbar({ editor, testId }: { editor: Editor; testId: string }) {
  // 선택·문서가 바뀔 때마다 켜짐 상태를 다시 읽는다 — 그 밖의 렌더는 일으키지 않는다.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...Object.fromEntries(GROUPS.flat().map((a) => [a.key, a.isActive(e)])),
      link: e.isActive('link'),
    }) as Record<string, boolean>,
  });

  return (
    <div
      role="toolbar"
      aria-label="서식"
      id={`${testId}-toolbar`}
      data-testid={`${testId}-toolbar`}
      // 모바일은 한 줄 가로 스크롤(스크롤바 숨김), 데스크톱은 폭 안에서 한 줄.
      className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex shrink-0 items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />}
          {group.map((a) => (
            <Button
              key={a.key}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${a.label} (${a.shortcut})`}
              title={`${a.label} (${a.shortcut})`}
              aria-pressed={active[a.key]}
              data-testid={`${testId}-${a.key}`}
              onClick={() => a.run(editor)}
              {...keepFocusProps}
              className={cn(BUTTON_CLASS, ghostToggleClass(active[a.key]))}
            >
              <a.icon aria-hidden />
            </Button>
          ))}
        </div>
      ))}
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
      <LinkButton editor={editor} active={active.link} testId={`${testId}-link`} />
    </div>
  );
}

/**
 * 링크 — 누르면 주소 입력 팝오버. 고른 글이 있으면 그 글에, 없으면 주소 자체를 글로 넣는다. 이미 링크 안이면 주소를 고친다(비우면 링크 해제).
 * 열 수 없는 주소(javascript: 등)는 받지 않는다 — 렌더러도 http(s)·mailto 만 링크로 그린다.
 */
function LinkButton({ editor, active, testId }: { editor: Editor; active: boolean; testId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setValue((editor.getAttributes('link').href as string | undefined) ?? '');
      setInvalid(false);
    }
    setOpen(next);
  };

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const raw = value.trim();
    if (raw === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setOpen(false);
      return;
    }
    const normalized = normalizeLinkInput(raw);
    const href = normalized ? safeHref(normalized) : null;
    if (!href) {
      setInvalid(true);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !active) {
      // 고른 글이 없으면 주소를 글로 넣는다(링크 마크를 붙여 넣고, 이어 쓰는 글엔 링크가 이어지지 않게 마크를 끈다).
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).unsetMark('link').run();
    } else {
      chain.setLink({ href }).run();
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="링크"
          title="링크"
          aria-pressed={active}
          data-testid={testId}
          {...keepFocusProps}
          className={cn(BUTTON_CLASS, ghostToggleClass(active))}
        >
          <Link2 aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] rounded-lg p-2"
        data-testid={`${testId}-popover`}
        // 닫히면 에디터로 포커스를 돌린다(트리거 버튼은 포커스를 받지 않는 버튼이라 Radix 기본 복원 대상이 없다).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.commands.focus();
        }}
      >
        <form onSubmit={apply} className="flex flex-col gap-1.5" noValidate>
          <div className="flex items-center gap-2">
            <Input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setInvalid(false);
              }}
              placeholder="https://"
              aria-label="링크 주소"
              aria-invalid={invalid || undefined}
              data-testid={`${testId}-input`}
              // 모바일 16px(포커스 시 iOS 확대 방지)·44px.
              className="h-8 max-lg:h-11 max-lg:text-base"
            />
            <Button type="submit" size="sm" className="max-lg:h-11" data-testid={`${testId}-apply`}>
              {active ? '고치기' : '넣기'}
            </Button>
          </div>
          {invalid && (
            <p role="alert" className="text-sm text-destructive" data-testid={`${testId}-error`}>
              올바른 링크 주소를 입력하세요
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}
