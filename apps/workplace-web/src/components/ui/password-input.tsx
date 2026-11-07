import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { Input } from './input';

/**
 * 비밀번호 표시/숨김 토글이 포함된 입력 컴포넌트.
 * - 우측에 Eye/EyeOff 아이콘 버튼을 absolute positioning으로 배치하여 input 내부에 겹쳐 표시한다.
 * - aria-label "<fieldLabel> 보기"/"<fieldLabel> 숨기기" 로 스크린리더 접근성 확보.
 *   한 폼에 비밀번호 칸이 여럿이면 fieldLabel 에 칸의 레이블을 넘겨 어느 칸의 버튼인지 구분되게 한다(WP-923).
 * - autoComplete 등 표준 input 속성을 그대로 forwarding 한다 (브라우저 비밀번호 매니저 호환).
 * - 토글 버튼은 type="button"으로 폼 submit 차단.
 * - 토글 버튼은 Tab 순서에 둔다(비밀번호 칸 다음) — 키보드만 쓰는 사용자도 Tab 으로 닿아 Enter/Space 로 전환할 수 있게(WCAG 2.1.1, WP-1426).
 *   칸 사이 Tab 이 한 번 늘지만 키보드 접근이 우선이다.
 * - 상태는 바뀌는 이름(「… 보기」↔「… 숨기기」)으로 알린다. aria-pressed 는 붙이지 않는다 — 이름이 바뀌는 버튼에 눌림 상태를 더하면
 *   스크린리더가 상태를 두 번(이름·눌림) 읽고, 「숨기기, 눌림」처럼 뜻이 엇갈린다(WAI-ARIA APG: 토글 버튼은 이름을 고정하고 눌림만 바꾼다).
 */
function PasswordInput({
  className,
  fieldLabel = '비밀번호',
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & {
  /** 보기/숨기기 버튼 이름 앞에 붙는 칸 이름(기본 「비밀번호」). */
  fieldLabel?: string;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        // 우측 아이콘 영역만큼 padding을 추가하여 텍스트가 아이콘과 겹치지 않도록 함
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={`${fieldLabel} ${visible ? '숨기기' : '보기'}`}
        // 이 버튼이 어느 칸을 바꾸는지 보조기기에 잇는다 — id 를 받은 칸일 때만(없으면 가리킬 대상이 없어 생략).
        aria-controls={props.id}
        // 칸이 비활성이면 버튼도 막는다 — Tab 순서에 들어온 뒤로는 키보드로 잠긴 칸의 비밀번호를 드러낼 수 있었다(WP-1426).
        disabled={props.disabled}
        // 클릭 영역을 충분히 확보 (44x36) — 모바일 탭 친화적
        className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 rounded-r-md"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export { PasswordInput };
