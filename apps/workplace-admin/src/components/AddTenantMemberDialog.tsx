import { useUserEmailLookup } from '../hooks/useUserEmailLookup'
import { ExistingTenantMemberForm } from './ExistingTenantMemberForm'
import { NewTenantMemberForm } from './NewTenantMemberForm'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { FormField } from './ui/form-field'
import { UserEmailLookupField } from './UserEmailLookupField'

interface AddTenantMemberDialogProps {
  // 대상 테넌트 — useParams 의 string id. invalidate 키를 byte-identical 하게 맞추기 위해 string 으로 받는다.
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 테넌트 멤버 추가 다이얼로그 — 이메일 확인 후 기존/신규 사용자로 분기한다.
// 1) 이메일 입력 + "확인" 클릭 → GET /users/lookup 정확일치 조회(useUserEmailLookup — 소유자 지정과 공용)
// 2) 찾음(200): ExistingTenantMemberForm — 계정 생성 없이 멤버십만 추가
//    못 찾음(404): NewTenantMemberForm — 기존과 동일한 신규 계정 생성 폼
// 확인 후 이메일을 다시 수정하면 조회 상태를 초기화해 재확인을 요구한다(오래된 조회 결과로
// 잘못된 사용자에게 추가되는 것 방지).
export function AddTenantMemberDialog({
  tenantId,
  open,
  onOpenChange,
}: AddTenantMemberDialogProps) {
  const lookup = useUserEmailLookup()

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      lookup.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>멤버 추가</DialogTitle>
          <DialogDescription>
            이메일을 확인해 기존 사용자면 바로 추가하고, 신규 사용자면 계정을 생성해 추가합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="이메일" htmlFor="member-email" required error={lookup.error}>
            <UserEmailLookupField
              lookup={lookup}
              id="member-email"
              inputTestId="add-member-email"
              checkTestId="add-member-check"
            />
          </FormField>

          {lookup.user && (
            <ExistingTenantMemberForm
              tenantId={tenantId}
              user={lookup.user}
              onCancel={() => handleOpenChange(false)}
              onSuccess={() => handleOpenChange(false)}
            />
          )}

          {lookup.status === 'not-found' && (
            <NewTenantMemberForm
              tenantId={tenantId}
              email={lookup.checkedEmail}
              onCancel={() => handleOpenChange(false)}
              onSuccess={() => handleOpenChange(false)}
            />
          )}

          {lookup.status === 'idle' && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                취소
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
