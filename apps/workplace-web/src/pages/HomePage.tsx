import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// v1 골격 검증용 데모 페이지 — Button / Dialog / Sonner / 다크모드 토글 작동 확인.
export default function HomePage() {
  const [open, setOpen] = useState(false)

  return (
    <div className="container mx-auto p-8 space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Smart Workplace</h1>
        <p className="text-muted-foreground">AI Native 이슈 트래커 — v1 골격 셋업 검증 페이지.</p>
      </section>

      <section className="flex gap-3">
        <Button onClick={() => toast.success('성공 토스트')}>토스트 (성공)</Button>
        <Button variant="destructive" onClick={() => toast.error('에러 토스트')}>
          토스트 (에러)
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">다이얼로그 열기</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>샘플 다이얼로그</DialogTitle>
              <DialogDescription>shadcn/Radix Dialog 동작 확인용.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                닫기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  )
}
