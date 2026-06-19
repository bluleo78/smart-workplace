// 외부 연락처 생성/편집 모달. contact 가 있으면 편집 모드(프리필).
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { type SubmitHandler,useForm } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateExternalContact,
  useUpdateExternalContact,
} from '@/hooks/queries/useExternalContactMutations'
import {
  type ExternalContactFormData,
  externalContactSchema,
} from '@/lib/validations/contact'
import type { ContactVisibility, ExternalContactDetail } from '@/types/contact'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: ExternalContactDetail | null
}

const EMPTY: ExternalContactFormData = {
  name: '',
  email: '',
  phone: '',
  organization: '',
  title: '',
  notes: '',
  visibility: 'PERSONAL',
}

export function ExternalContactFormDialog({ open, onOpenChange, contact }: Props) {
  const isEdit = !!contact
  const create = useCreateExternalContact()
  const update = useUpdateExternalContact()

  const form = useForm<ExternalContactFormData>({
    resolver: zodResolver(externalContactSchema),
    defaultValues: EMPTY,
  })

  // 다이얼로그가 열릴 때마다 프리필/초기화
  useEffect(() => {
    if (!open) return
    if (contact) {
      form.reset({
        name: contact.name,
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        organization: contact.organization ?? '',
        title: contact.title ?? '',
        notes: contact.notes ?? '',
        visibility: contact.visibility,
      })
    } else {
      form.reset(EMPTY)
    }
  }, [open, contact, form])

  const onSubmit: SubmitHandler<ExternalContactFormData> = async (data) => {
    try {
      if (isEdit && contact) {
        await update.mutateAsync({ id: contact.id, body: data })
      } else {
        await create.mutateAsync(data)
      }
      onOpenChange(false)
    } catch {
      /* 토스트는 mutation onError 가 처리 */
    }
  }

  const saving = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="external-contact-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '외부 연락처 수정' : '새 외부 연락처'}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? '외부 연락처 수정' : '새 외부 연락처'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {/* 이름 — 필수 필드: required prop 으로 붉은 별표 표시 */}
          <FormField label="이름" htmlFor="c-name" required error={form.formState.errors.name?.message}>
            <Input id="c-name" data-testid="c-name" {...form.register('name')} />
          </FormField>
          <FormField label="이메일" htmlFor="c-email" error={form.formState.errors.email?.message}>
            <Input id="c-email" type="email" data-testid="c-email" {...form.register('email')} />
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="전화" htmlFor="c-phone" error={form.formState.errors.phone?.message}>
              <Input id="c-phone" data-testid="c-phone" {...form.register('phone')} />
            </FormField>
            <FormField
              label="소속"
              htmlFor="c-org"
              error={form.formState.errors.organization?.message}
            >
              <Input id="c-org" data-testid="c-org" {...form.register('organization')} />
            </FormField>
          </div>
          <FormField label="직책" htmlFor="c-title" error={form.formState.errors.title?.message}>
            <Input id="c-title" data-testid="c-title" {...form.register('title')} />
          </FormField>
          <FormField label="메모" htmlFor="c-notes">
            <Textarea id="c-notes" data-testid="c-notes" rows={3} {...form.register('notes')} />
          </FormField>
          <FormField label="공개 범위" htmlFor="c-visibility">
            <Select
              value={form.watch('visibility')}
              onValueChange={(v) => form.setValue('visibility', v as ContactVisibility)}
            >
              <SelectTrigger id="c-visibility" data-testid="c-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERSONAL">개인</SelectItem>
                <SelectItem value="SHARED">공유</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={saving} data-testid="c-save">
              {saving ? '저장 중…' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
