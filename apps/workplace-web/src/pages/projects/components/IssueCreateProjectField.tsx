// 새 이슈 창의 「프로젝트」 칸(WP-1768) — 프로젝트가 정해지지 않은 곳(채팅·노트의 사람 카드 「일 맡기기」)에서 연 창이 맨 위에 그린다.
// 데스크톱 대화상자와 모바일 시트가 같이 쓴다. 고를 수 있는 것은 내가 속한 팀 프로젝트뿐이다 — 개인 프로젝트는 AI 에게 맡길 곳이 아니고,
// 접수 전용(OPEN 비멤버)은 담당자·유형을 정할 수 없어 「일 맡기기」가 되지 않는다.
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/overlay/select';

import type { ProjectResponse } from '../../../types/project';

/** 「프로젝트」 칸 — 고르면 창이 그 프로젝트로 유형·후보를 다시 받는다(제목·본문은 남는다). */
export function IssueCreateProjectField({
  projects,
  value,
  onChange,
  locked,
}: {
  projects: readonly ProjectResponse[];
  value: string;
  onChange: (key: string) => void;
  /** 본문에 이미지를 넣었거나 올리는 중 — 이미지는 이 프로젝트 주소로 올라가 다른 프로젝트 이슈에 이어지지 않으므로 바꾸지 못하게 잠그고 이유를 보인다. */
  locked?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor="issue-create-project">프로젝트</label>
      <Select value={value} onValueChange={(v) => { if (v) onChange(v); }} disabled={locked}>
        <SelectTrigger
          id="issue-create-project"
          aria-label="프로젝트"
          aria-describedby={locked ? 'issue-create-project-locked' : undefined}
          className="w-full"
          data-testid="create-project-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.key} value={p.key}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {locked && (
        <p id="issue-create-project-locked" className="text-xs text-muted-foreground" data-testid="create-project-locked">
          이미지를 넣은 뒤에는 프로젝트를 바꿀 수 없습니다
        </p>
      )}
    </div>
  );
}
