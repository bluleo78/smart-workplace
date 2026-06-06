# 09. Form Patterns

폼 구성, 유효성 검사, 상태 표시에 관한 패턴을 정의한다.

**기술 스택**: React Hook Form(`^7.76`) + Zod(`^4.4`) via `@hookform/resolvers/zod`(`^5.2`). Zod 스키마는 `src/lib/validations/` 에 도메인별로 둔다(`auth.ts`, `contact.ts`, `issue.ts`, `project.ts`, `user.ts`, `userGroup.ts` 등). 폼 필드 래퍼는 `components/ui/form-field.tsx` 의 `FormField`([04 §B-2](./04-components.md))를 사용한다.

> 관련 문서: [04. Components](./04-components.md) · [06. Feedback States](./06-feedback-states.md) · [07. Iconography](./07-iconography.md)

---

## A. Field Anatomy (필드 구조)

각 폼 필드는 **Label → Input → Error** 3단으로 구성된다. (fire-hub 와 달리 워크플레이스 `FormField` 에는 `description` 슬롯이 없다.)

```
┌─ Label (Label 컴포넌트, required 시 빨간 *) ──┐
├─ Input (h-9, px-3 py-2, text-sm) ────────────┤
│  Error (text-sm text-destructive) ───────────┘
```

`FormField` 실제 구현:

```tsx
// components/ui/form-field.tsx
export function FormField({ label, htmlFor, error, required, children, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

---

## B. Spacing (간격 규칙)

| 위치 | Tailwind |
|------|----------|
| Label → Input → Error (필드 내부) | `space-y-2` (FormField 가 적용) |
| 필드 → 필드 (기본) | `space-y-4` |
| 필드 → 필드 (컴팩트, 다이얼로그) | `space-y-3` |
| 섹션 → 섹션 | `space-y-8` |

```tsx
// 기본 폼
<form className="space-y-4">
  <FormField label="제목" required>...</FormField>
  <FormField label="설명">...</FormField>
</form>

// 다이얼로그 폼(컴팩트) — 실측: GroupForm.tsx 가 space-y-3 사용
<form onSubmit={onSubmit} className="space-y-3">
  <FormField label="이름" htmlFor="g-name" error={form.formState.errors.name?.message}>
    <Input id="g-name" {...form.register('name')} />
  </FormField>
</form>

// 섹션 구분 폼
<form className="space-y-8">
  <section className="space-y-4">
    <h3 className="text-sm font-semibold">기본 정보</h3>
    <FormField label="제목">...</FormField>
  </section>
</form>
```

---

## C. Input States (입력 상태)

`Input`(`input.tsx`)은 4가지 상태를 가진다 (모두 shadcn 기본 클래스로 제공).

| 상태 | 시각적 표현 | Tailwind |
|------|-----------|---------|
| Default | 회색 테두리 | `border-input` |
| Focus | Ring + 테두리 강조 | `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]` |
| Error | 빨간 테두리 + Ring | `aria-invalid:border-destructive aria-invalid:ring-destructive/20` |
| Disabled | 50% 투명도, not-allowed | `disabled:opacity-50 disabled:pointer-events-none` |

```tsx
<Input
  {...form.register("name")}
  aria-invalid={!!errors.name}   // Error 상태 활성화 (빨간 테두리/Ring)
  disabled={isSubmitting}        // Disabled 상태 활성화
/>
```

---

## D. Input Heights (입력 높이)

| 크기 | 높이 | 사용 맥락 |
|------|------|----------|
| Default | `h-9` (36px) | 표준 폼 입력 |
| Small | `h-8` (32px) | 컴팩트/인라인 폼, 필터 (예: SimplePagination 의 사이즈 selector) |

```tsx
<Input className="h-9" placeholder="이슈 제목" />        {/* 기본 */}
<Input className="h-8 text-xs" placeholder="필터..." />  {/* 소형 */}
```

---

## E. Validation Timing (유효성 검사 시점)

워크플레이스 폼은 **대부분 기본 모드(`onSubmit`)** 를 사용한다 — `useForm()` 에 `mode` 를 지정하지 않으면 제출 시 검사하고, 이후 에러가 표시된 필드는 변경 시 재검사한다. 즉시 피드백이 필요한 일부 폼(예: `ProfileSettingsPage`)만 `mode: 'onChange'` 를 명시한다.

```tsx
// 기본 (대부분) — 제출 시 검사
const form = useForm<FormData>({
  resolver: zodResolver(schema),
  defaultValues: { name: '', parentId: null },
});

// 즉시 피드백이 필요한 폼만 명시
const form = useForm<FormData>({
  resolver: zodResolver(schema),
  mode: 'onChange',
});
```

> fire-hub 템플릿의 `mode: 'onBlur'` 표는 워크플레이스에 적용하지 않는다. 코드베이스 실측: 기본(onSubmit) + 일부 `onChange`.

---

## F. Standard Form Structure (표준 폼 구조)

React Hook Form + Zod 표준 패턴. Zod 스키마는 `lib/validations/` 에서 import 한다.

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { handleApiError } from "@/lib/api-error";
import { issueSchema, type IssueFormData } from "@/lib/validations/issue";

function IssueForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const form = useForm<IssueFormData>({
    resolver: zodResolver(issueSchema),
    defaultValues: { title: "", description: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await createIssue(data);
      toast.success("이슈가 생성되었습니다");
      onSuccess();
    } catch (err) {
      handleApiError(err, "이슈 생성에 실패했습니다");
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* 폼 수준 에러 (선택) */}
      {errors.root && (
        <p className="text-sm text-destructive">{errors.root.message}</p>
      )}

      <FormField label="제목" htmlFor="title" error={errors.title?.message} required>
        <Input
          id="title"
          {...form.register("title")}
          aria-invalid={!!errors.title}
          placeholder="이슈 제목을 입력하세요"
        />
      </FormField>

      <FormField label="설명" htmlFor="description" error={errors.description?.message}>
        <Textarea
          id="description"
          {...form.register("description")}
          aria-invalid={!!errors.description}
          placeholder="설명을 입력하세요 (선택)"
          rows={4}
        />
      </FormField>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          취소
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          저장
        </Button>
      </div>
    </form>
  );
}
```

---

## G. Error Display Pattern (에러 표시 패턴)

에러 발생 위치에 따라 표시 방법이 다르다.

### 폼 수준 에러 (Form-level)

폼 전체에 영향을 주는 에러(서버 충돌, 권한 없음 등)는 폼 상단에 표시한다.

```tsx
{errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

// API 에러를 폼 수준으로 끌어올릴 때
catch (err) {
  form.setError("root", { message: extractApiError(err, "저장에 실패했습니다") });
}
```

### 필드 수준 에러 (Field-level)

`FormField` 가 `error` prop 을 받아 입력 아래에 자동 표시한다.

```tsx
<FormField label="제목" htmlFor="title" error={errors.title?.message}>
  <Input id="title" {...form.register("title")} aria-invalid={!!errors.title} />
</FormField>
```

### API 에러 (Toast)

비동기 에러는 토스트로 표시한다. 워크플레이스는 `handleApiError(err, fallback)` 래퍼를 표준으로 쓴다 — **`fallback`(두 번째 인자)은 필수**다([06 §C](./06-feedback-states.md)).

```tsx
catch (err) {
  handleApiError(err, "삭제에 실패했습니다");
}
```

> TanStack Query mutation 을 쓰는 폼은 `mutation.onError` 에서 `handleApiError` 를 한 번만 처리하고, 컴포넌트 `catch` 는 비워두기도 한다(`GroupForm.tsx`). 에러 토스트가 중복되지 않게 한 곳에서만 처리한다.

---

## H. Select / Combobox 패턴

워크플레이스 폼은 `Controller` 대신 RHF 의 `watch`/`setValue` 로 비제어 입력(native `select`, shadcn `Select`)을 연결하는 경우가 많다(실측: `GroupForm.tsx`).

```tsx
// native select + setValue/watch (GroupForm 패턴)
<FormField label="상위 그룹" htmlFor="g-parent">
  <select
    id="g-parent"
    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
    value={form.watch('parentId') ?? ''}
    onChange={(e) => form.setValue('parentId', e.target.value ? Number(e.target.value) : null)}
  >
    <option value="">최상위</option>
    {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
  </select>
</FormField>
```

shadcn `Select` 를 RHF 와 쓸 때도 동일하게 `value`/`onValueChange` 를 `watch`/`setValue` 에 연결한다:

```tsx
<FormField label="가시성" error={errors.visibility?.message} required>
  <Select
    value={form.watch('visibility')}
    onValueChange={(v) => form.setValue('visibility', v as Visibility, { shouldValidate: true })}
  >
    <SelectTrigger aria-invalid={!!errors.visibility}>
      <SelectValue placeholder="선택하세요" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="SHARED">공유</SelectItem>
      <SelectItem value="PERSONAL">개인</SelectItem>
    </SelectContent>
  </Select>
</FormField>
```

옵션이 많아 검색이 필요하면 `SearchableSelect`([04 §B-4](./04-components.md))를 쓴다:

```tsx
<FormField label="담당자" htmlFor="assignee">
  <SearchableSelect
    id="assignee"
    value={form.watch('assigneeId')}
    onChange={(v) => form.setValue('assigneeId', v)}
    options={members.map(m => ({ value: String(m.id), label: m.name }))}
    placeholder="담당자 선택"
    allowClear
  />
</FormField>
```

---

## I. 리치 텍스트 / 멘션 입력 (tiptap)

이슈 댓글, 팀 채팅, 메일 본문처럼 **멘션·리치 입력**이 필요한 곳은 `Textarea` 대신 tiptap(`@tiptap/*`) 기반 컴포넌트를 사용한다. 이는 RHF `register` 대상이 아니라, 자체 상태(에디터)를 갖고 `onSubmit(body)` 콜백으로 직렬화된 본문을 넘긴다.

| Component | File | 용도 |
|-----------|------|------|
| `RichInput` | `components/mentions/RichInput.tsx` | 멘션 칩 + `@` suggestion. **Enter=전송, Shift+Enter=줄바꿈, Esc=취소**. 한글 IME 조합은 ProseMirror 가 처리 |
| `MailComposer` | `components/mail/MailComposer.tsx` | 메일 본문 작성 |

```tsx
// 이슈 댓글/채팅 입력 — RHF 가 아닌 자체 onSubmit 콜백
<RichInput
  members={mentionCandidates}
  placeholder="댓글 입력 (Shift+Enter 로 줄바꿈)"
  onSubmit={(body) => createComment({ body })}
  submitLabel="등록"
  clearOnSubmit
  inputTestId="comment-input"
  submitTestId="comment-submit"
/>
```

> 멘션 본문 직렬화/역직렬화는 `components/mentions/mentionSerialize.ts` 의 `serializeToBody`/`bodyToDoc` 이 담당한다. 단순 텍스트 입력에는 tiptap 을 쓰지 않고 `Input`/`Textarea` 를 쓴다.

---

## J. 비밀번호 입력

인증 폼의 비밀번호는 `PasswordInput`([04 §B-5](./04-components.md))를 쓴다 — 표시/숨김 토글 내장, 표준 input 속성 forwarding.

```tsx
<FormField label="비밀번호" htmlFor="password" error={errors.password?.message} required>
  <PasswordInput
    id="password"
    {...form.register("password")}
    autoComplete="current-password"
    aria-invalid={!!errors.password}
  />
</FormField>
```

---

## K. Zod 스키마 컨벤션

스키마는 `src/lib/validations/<domain>.ts` 에 두고, 타입은 `z.infer` 로 도출한다. optional 필드는 빈 문자열을 허용하고 백엔드가 null 로 정규화하는 패턴을 쓴다(실측: `contact.ts`).

```ts
// lib/validations/contact.ts (발췌)
import { z } from "zod";

export const externalContactSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요").max(120, "120자 이내"),
  email: z.string().trim().max(255, "255자 이내")
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "유효한 이메일을 입력하세요"),
  visibility: z.enum(["SHARED", "PERSONAL"]),
});

export type ExternalContactFormData = z.infer<typeof externalContactSchema>;
```

> 에러 메시지는 **한국어**로 작성한다. 서버 검증 메시지도 한국어이며, `extractApiError` 가 필드 검증 오류(`errors`)의 첫 메시지를 우선 토스트로 노출한다([06 §C](./06-feedback-states.md)).

---

## L. 접근성 (Accessibility)

- `<label>` 과 입력은 반드시 연결한다 — `FormField` 의 `htmlFor` + 입력의 `id`.
- 필수 필드는 `required` prop(시각적 `*`)을 제공한다.
- 에러 상태는 입력에 `aria-invalid={!!errors.field}` 로 전달한다.
- 단독 아이콘 컨트롤(비밀번호 토글, 검색 clear)은 `aria-label` 을 갖는다(공통 컴포넌트에 내장됨).

```tsx
<FormField label="이름" htmlFor="name" error={errors.name?.message} required>
  <Input id="name" {...form.register("name")} aria-invalid={!!errors.name} />
</FormField>
```
