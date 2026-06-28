// #520 이슈 초안 필드 표현(공유). 메일 모달(editable)·채팅 카드(editable=false)가 함께 쓴다.
// 라이프사이클·버튼·확인 동작은 소비처 소유 — 이 컴포넌트는 필드 렌더+onChange 만.
// XSS 방어: editable=false 에서 메일 본문(공격자 콘텐츠)을 절대 HTML 로 렌더하지 않는다.
import { Bot } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export interface IssueDraftValue {
  title: string
  body: string
  priority: 'LOW' | 'MID' | 'HIGH'
  projectKey: string
  assigneeIds: number[]
}

export interface IssueDraftFieldsProps {
  value: IssueDraftValue
  onChange: (patch: Partial<IssueDraftValue>) => void
  /** 프로젝트 후보 목록 */
  candidateProjects: { key: string; name: string }[]
  /** 선택 프로젝트 멤버 (HUMAN | AGENT) */
  members: { userId: number; name: string; kind: 'HUMAN' | 'AGENT' }[]
  editable: boolean
  /**
   * 읽기 전용(editable=false) 시 프로젝트 행 표시 여부 (기본 true).
   * 소비처가 별도로 프로젝트 드롭다운을 렌더할 때 false 를 넘겨 중복 표시를 방지한다.
   * editable=true 브랜치에는 영향을 주지 않는다.
   */
  showProject?: boolean
}

/** 우선순위 레이블 */
const PRIORITY_LABEL: Record<IssueDraftValue['priority'], string> = {
  LOW: '낮음',
  MID: '보통',
  HIGH: '높음',
}

export function IssueDraftFields(props: IssueDraftFieldsProps) {
  const { value, onChange, candidateProjects, members, editable, showProject = true } = props
  // 담당 단일 선택(현재 스코프: 0 또는 1명). '' = 미지정.
  const assignee = value.assigneeIds[0]
  const projectName =
    candidateProjects.find((p) => p.key === value.projectKey)?.name ?? value.projectKey

  if (!editable) {
    // 읽기 전용 — body 는 텍스트로만 표시(dangerouslySetInnerHTML 금지).
    // showProject=false 일 때 프로젝트 행을 숨겨 소비처 드롭다운과 중복을 방지.
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium text-foreground">{value.title}</div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {showProject && <span>프로젝트: {projectName}</span>}
          <span>우선순위: {PRIORITY_LABEL[value.priority]}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="issue-draft-title">
          제목
        </label>
        <Input
          id="issue-draft-title"
          data-testid="issue-draft-title"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="issue-draft-body">
          본문
        </label>
        <Textarea
          id="issue-draft-body"
          data-testid="issue-draft-body"
          rows={6}
          value={value.body}
          onChange={(e) => onChange({ body: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">프로젝트</label>
          <Select
            value={value.projectKey}
            onValueChange={(v) => onChange({ projectKey: v, assigneeIds: [] })}
          >
            <SelectTrigger data-testid="issue-draft-project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {candidateProjects.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">우선순위</label>
          <Select
            value={value.priority}
            onValueChange={(v) =>
              onChange({ priority: v as IssueDraftValue['priority'] })
            }
          >
            <SelectTrigger data-testid="issue-draft-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LOW">낮음</SelectItem>
              <SelectItem value="MID">보통</SelectItem>
              <SelectItem value="HIGH">높음</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">담당</label>
          <Select
            value={assignee !== undefined ? String(assignee) : ''}
            onValueChange={(v) => onChange({ assigneeIds: v ? [Number(v)] : [] })}
          >
            <SelectTrigger data-testid="issue-draft-assignee">
              <SelectValue placeholder="미지정" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.userId} value={String(m.userId)}>
                  <span className="inline-flex items-center gap-1">
                    {m.name}
                    {m.kind === 'AGENT' && (
                      <Bot className="h-3 w-3" aria-label="에이전트" />
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
