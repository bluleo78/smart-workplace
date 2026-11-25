/** 이슈 WP-2040 첨부 C-before.yaml 원문 픽스처 — sourcePreserve·graphYaml 테스트가 함께 쓴다. */
export const SPEC = `schema: genia/workflow@1
name: AI 개발 흐름
roles:
  lead:      { name: 팀장,   members: [teamleader@iacloud.kr] }
  planner:   { name: 기획자, members: [planner@iacloud.kr] }
  developer: { name: 개발자, members: [dev1@example.com, dev2@example.com] }
  owner:     { name: 확인자, members: [owner@example.com] }

nodes:
  start:   { type: start }

  triage:
    type: agent_task
    name: 분류
    role: lead
    instructions: |
      이슈를 읽고 개발로 바로 갈지, 기획이 필요한지 정한다.
    outcomes:
      need_plan: { to: plan,  assignTo: planner }    # 넘길 때 담당을 그 역할로 바꿈
      ready:     { to: dev,   assignTo: developer }

  plan:
    type: agent_task
    name: 기획
    role: planner
    instructions: |
      요구를 정리해 기획 문서를 만든다.
    outputs: { planDoc: { type: url, required: true } }   # 나갈 때 꼭 내놓을 값(검증기)
    outcomes:
      done: { to: plan_ok, assignTo: owner }

  plan_ok:
    type: human_task
    name: 기획 확정
    role: owner
    timeout: { after: P2D, then: remind }                 # 이틀 넘으면 다시 알림
    outcomes:
      approve: { to: dev,  assignTo: developer }
      revise:  { to: plan, assignTo: planner, requireComment: true }

  dev:
    type: agent_task
    name: 개발
    role: developer
    instructions: |
      기획대로 구현하고 PR 을 올린다.
    outputs: { prUrl: { type: url, required: true } }
    outcomes:
      submitted: { to: review, assignTo: lead }
      ask:       { to: dev_ask, assignTo: owner, requireComment: true }   # 사람에게 질문 — 의견이 질문
    onError: { to: triage, assignTo: lead }                # 차단·실패가 풀리지 않을 때 갈 곳(선택)

  dev_ask:                                                 # 질문 경로 — 그래프에 그대로 보인다
    type: human_task
    name: 개발 질문 답변
    role: owner
    returnTo: dev                                          # 답하면 질문한 노드·그 AI 에게 돌아감
    timeout: { after: P1D, then: remind }
    outcomes:
      answered: { to: dev, assignTo: keep, requireComment: true }      # 의견이 답

  review:
    type: agent_task
    name: 코드 리뷰
    role: lead
    instructions: |
      PR 을 검토한다.
    outcomes:
      merged:  { to: confirm, assignTo: owner }
      changes: { to: dev, assignTo: keep }                 # 앞 개발자에게 돌려보냄
    maxVisits: 3                                           # 같은 실행에서 3번째 들어오면 사람에게 알림(지금 「회귀 3회」)

  confirm:
    type: human_task
    name: 검토
    role: owner
    outcomes:
      accept: { to: done }
      rework: { to: dev, assignTo: keep, requireComment: true }

  done: { type: end }

start:                       # start 노드에서 나가는 자동 연결
  - { when: { assigneeRole: lead },      to: triage }
  - { when: { assigneeRole: planner },   to: plan }
  - { when: { assigneeRole: developer }, to: dev }

layout: { triage: { x: 200, y: 0 } }      # 그래프 편집기 좌표(선택)
`
