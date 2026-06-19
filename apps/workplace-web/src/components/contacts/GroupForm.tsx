// 개인 그룹 생성/편집 다이얼로그 + 멤버 통합 검색 피커.
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'

import { contactsApi } from '@/api/contacts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  useAddGroupMember,
  useCreateUserGroup,
  useRemoveGroupMember,
  useUpdateUserGroup,
} from '@/hooks/queries/useUserGroupMutations'
import { type UserGroupFormData, userGroupSchema } from '@/lib/validations/userGroup'
import type { ContactSummary } from '@/types/contact'
import type { GroupMemberType, UserGroupDetail } from '@/types/userGroup'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 편집 대상(직속 멤버 포함). null 이면 생성 모드. */
  group: UserGroupDetail | null
  /** 부모 선택 후보(개인 그룹 평면 목록). */
  personalOptions: { id: number; name: string }[]
}

interface PickedMember {
  targetType: GroupMemberType
  targetId: number
  name: string
}

/** 개인 그룹 생성/편집 + 멤버 통합 검색 피커. */
export function GroupForm({ open, onOpenChange, group, personalOptions }: Props) {
  const isEdit = !!group
  const create = useCreateUserGroup()
  const update = useUpdateUserGroup()
  const addMember = useAddGroupMember()
  const removeMember = useRemoveGroupMember()
  const form = useForm<UserGroupFormData>({
    resolver: zodResolver(userGroupSchema),
    defaultValues: { name: '', parentId: null },
  })

  const [picked, setPicked] = useState<PickedMember[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [results, setResults] = useState<ContactSummary[]>([])

  // 다이얼로그 열릴 때마다 상태 초기화/프리필
  useEffect(() => {
    if (!open) return
    if (group) {
      form.reset({ name: group.name, parentId: group.parentId })
      setPicked(
        group.members.map((m) => ({ targetType: m.targetType, targetId: m.targetId, name: m.name })),
      )
    } else {
      form.reset({ name: '', parentId: null })
      setPicked([])
    }
    setMemberSearch('')
    setResults([])
  }, [open, group, form])

  // 멤버 검색 — contacts 통합 목록 재사용(디바운스 300ms)
  useEffect(() => {
    if (!memberSearch.trim()) {
      setResults([])
      return
    }
    const handle = setTimeout(() => {
      contactsApi
        .list({ search: memberSearch.trim() })
        .then((r) => setResults(r.data.items))
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [memberSearch])

  const isPicked = (c: ContactSummary) =>
    picked.some((p) => p.targetType === c.type && p.targetId === c.id)

  const togglePick = (c: ContactSummary) => {
    setPicked((prev) =>
      isPicked(c)
        ? prev.filter((p) => !(p.targetType === c.type && p.targetId === c.id))
        : [...prev, { targetType: c.type, targetId: c.id, name: c.name }],
    )
  }

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      if (isEdit && group) {
        await update.mutateAsync({
          id: group.id,
          body: { name: data.name, parentId: data.parentId, code: null, sortOrder: group.sortOrder },
        })
        // 멤버 diff 적용
        const before = group.members
        const removed = before.filter(
          (b) => !picked.some((p) => p.targetType === b.targetType && p.targetId === b.targetId),
        )
        const added = picked.filter(
          (p) => !before.some((b) => b.targetType === p.targetType && b.targetId === p.targetId),
        )
        for (const r of removed) {
          await removeMember.mutateAsync({ id: group.id, targetType: r.targetType, targetId: r.targetId })
        }
        for (const a of added) {
          await addMember.mutateAsync({ id: group.id, body: { targetType: a.targetType, targetId: a.targetId } })
        }
      } else {
        const created = await create.mutateAsync({
          name: data.name,
          parentId: data.parentId,
          visibility: 'PERSONAL',
          code: null,
          sortOrder: 0,
        })
        for (const a of picked) {
          await addMember.mutateAsync({ id: created.id, body: { targetType: a.targetType, targetId: a.targetId } })
        }
      }
      onOpenChange(false)
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  })

  const saving = create.isPending || update.isPending || addMember.isPending || removeMember.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="group-form-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '그룹 수정' : '새 그룹'}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? '그룹 수정' : '새 그룹'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <FormField label="이름" htmlFor="g-name" error={form.formState.errors.name?.message}>
            <Input id="g-name" data-testid="g-name" {...form.register('name')} />
          </FormField>
          <FormField label="상위 그룹" htmlFor="g-parent">
            {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270).
                Radix는 빈 문자열 value를 허용하지 않아 '__top__' 센티넬로 최상위(null)를 표현. */}
            <Select
              value={form.watch('parentId') != null ? String(form.watch('parentId')) : '__top__'}
              onValueChange={(v) =>
                form.setValue('parentId', v === '__top__' ? null : Number(v))
              }
            >
              <SelectTrigger id="g-parent" data-testid="g-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__top__">최상위</SelectItem>
                {personalOptions
                  .filter((o) => !group || o.id !== group.id)
                  .map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* 멤버 통합 검색 피커 */}
          <div className="space-y-2">
            <span className="text-sm font-medium">멤버</span>
            <Input
              data-testid="g-member-search"
              placeholder="멤버·외부 연락처 검색"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {results.map((c) => (
                  <button
                    key={`${c.type}-${c.id}`}
                    type="button"
                    data-testid={`g-member-result-${c.type}-${c.id}`}
                    onClick={() => togglePick(c)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/50"
                  >
                    <span className="truncate">
                      {c.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        {c.type === 'MEMBER' ? '멤버' : '외부'}
                      </span>
                    </span>
                    {isPicked(c) && <span className="text-xs text-primary">선택됨</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1" data-testid="g-picked">
              {picked.map((p) => (
                <span
                  key={`${p.targetType}-${p.targetId}`}
                  className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs"
                >
                  {p.name}
                  <button
                    type="button"
                    data-testid={`g-picked-remove-${p.targetType}-${p.targetId}`}
                    onClick={() =>
                      setPicked((prev) =>
                        prev.filter(
                          (x) => !(x.targetType === p.targetType && x.targetId === p.targetId),
                        ),
                      )
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={saving} data-testid="g-save">
              {saving ? '저장 중…' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
