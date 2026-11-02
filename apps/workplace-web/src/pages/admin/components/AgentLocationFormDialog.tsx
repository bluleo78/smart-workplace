// 실행 환경 추가·변경 대화상자(WP-1256, 이름은 WP-1281) — 이름·설명·최대 AI 수. 추가하면 연결 토큰이 한 번 발급된다(onCreated 로 넘김).

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useCreateAgentLocation, useUpdateAgentLocation } from '../../../hooks/queries/useAgentRuntime';
import type { AgentLocation, AgentLocationTokenResponse } from '../../../types/agentRuntime';

interface Props {
  /** 고칠 위치 — null 이면 추가. */
  location: AgentLocation | null;
  onClose: () => void;
  onCreated: (res: AgentLocationTokenResponse) => void;
}

const MAX_CAPACITY = 100;

export function AgentLocationFormDialog({ location, onClose, onCreated }: Props) {
  const create = useCreateAgentLocation();
  const update = useUpdateAgentLocation();
  const [name, setName] = useState(location?.name ?? '');
  const [description, setDescription] = useState(location?.description ?? '');
  const [capacity, setCapacity] = useState(String(location?.capacity ?? 3));

  const cap = Number(capacity);
  const capError =
    !Number.isInteger(cap) || cap < 1 || cap > MAX_CAPACITY
      ? `최대 AI 수는 1~${MAX_CAPACITY} 사이 정수로 넣어 주세요`
      : location && cap < location.used
        ? `지금 실행 중인 AI(${location.used}명)보다 적게 줄일 수 없어요`
        : null;
  const valid = name.trim() !== '' && capError == null;
  const pending = create.isPending || update.isPending;

  const onSubmit = () => {
    const body = { name: name.trim(), description: description.trim() || null, capacity: cap };
    if (location) update.mutate({ id: location.id, ...body }, { onSuccess: onClose });
    else
      create.mutate(body, {
        onSuccess: (res) => {
          onClose();
          onCreated(res);
        },
      });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="agent-location-form">
        <DialogHeader>
          <DialogTitle>{location ? '이름·최대 AI 수 바꾸기' : '실행 환경 추가'}</DialogTitle>
          <DialogDescription>
            {location ? '이름·설명·최대 AI 수를 바꿔요.' : '만들면 연결 토큰이 한 번 발급되고 설치 순서를 안내해요.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">이름</Label>
            <Input id="loc-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="예: 운영 클러스터" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-desc">설명 (선택)</Label>
            <Input id="loc-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-cap">최대 AI 수</Label>
            <Input
              id="loc-cap"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_CAPACITY}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              aria-invalid={capError != null}
              className="w-28"
            />
            <p className={capError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {capError ?? '이 실행 환경에서 동시에 띄울 수 있는 AI 수예요. 클러스터 자원에 맞춰 정하세요.'}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={!valid || pending} data-testid="agent-location-submit">
              {location ? '저장' : '추가하고 토큰 발급'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
