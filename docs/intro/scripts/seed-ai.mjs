#!/usr/bin/env node
/**
 * AI 팀원(지니)에게 실제로 일을 시켜, 소개 자료에 실을 AI 결과물을 만든다.
 *
 *   INTRO_API=http://localhost:6160 node docs/intro/scripts/seed-ai.mjs
 *
 * 전제: seed-demo.mjs 실행 완료, ai-agent 기동, 지니에 LLM 토큰 등록(INTRO_AI_TOKEN 으로 넘기면 여기서 등록).
 *
 * 원칙: AI 의 코멘트·요약·제안은 지어낸 문구를 API 로 꽂지 않는다. 사람이 하는 것과 같은 방식으로
 * "요청"만 하고(담당자 지정, @멘션, 요약 버튼에 해당하는 API), 결과는 AI 가 남길 때까지 기다린다.
 * 그래서 실행할 때마다 문구가 조금씩 다르다 — 촬영 스크립트는 문구가 아니라 구조(테스트 ID)로 화면을 찾는다.
 */
import { AGENT, PEOPLE, PROJECT_KEY, login } from './seed-demo.mjs';

const API = (process.env.INTRO_API ?? 'http://localhost:6160') + '/api/v1';
const WAIT_MS = Number(process.env.INTRO_AI_WAIT_MS ?? 6 * 60 * 1000);

async function call(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 조건이 참이 될 때까지 폴링한다. AI 응답은 수십 초~수 분 걸린다. */
async function waitFor(label, check, intervalMs = 10000) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const v = await check();
    if (v) {
      console.log(`✓ ${label}`);
      return v;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`시간 초과: ${label}`);
}

/** 지니에게 맡길 업무 — 이슈 본문이 곧 지시다. 결과가 화면 한 장에 담길 만한 크기로 고른다. */
const TASKS = [
  {
    title: '베타 테스터 안내 메일 초안 작성',
    body:
      '사내 베타 테스터 200명에게 보낼 안내 메일 초안을 코멘트로 남겨 주세요.\n' +
      '- 노트의 "제품 요구사항 (PRD)" 를 참고해 이번 베타에서 써 볼 기능(간편 재주문)을 소개\n' +
      '- 참여 기간, 피드백 방법(대화 채널 #모바일-주문앱)을 포함\n' +
      '- 5~8 문장, 친근한 톤',
  },
  {
    title: '주간 회의록 액션 아이템 정리',
    body:
      '노트의 "주간 회의록 10월 1주" 에서 액션 아이템을 찾아 담당자·관련 이슈와 함께 표로 정리해 코멘트로 남겨 주세요. ' +
      '이미 이슈가 있는 항목은 이슈 번호를 연결해 주세요.',
  },
  {
    title: 'MOB-7 회귀 테스트 체크리스트 작성',
    body:
      'MOB-7(iOS 17 재주문 후 수량 0 표시) 수정이 들어간 뒤 확인할 회귀 테스트 체크리스트를 작성해 코멘트로 남겨 주세요. ' +
      '이슈 본문과 코멘트의 재현 조건을 참고해 주세요.',
  },
];

async function main() {
  const admin = await login(PEOPLE[0].username);
  const agentId = (await call(admin, 'GET', '/admin/agents')).find((a) => a.username === AGENT.username).id;

  // 0) LLM 토큰 — 환경변수로만 받는다(파일·커밋에 남기지 않는다).
  if (process.env.INTRO_AI_TOKEN) {
    await call(admin, 'POST', `/admin/agents/${agentId}/provider-credential`, {
      provider: 'anthropic',
      token: process.env.INTRO_AI_TOKEN,
      label: 'intro-demo',
    });
    await call(admin, 'PUT', '/admin/workspace-assistant', { agentUserId: agentId });
  }

  // 1) 이슈 위임 — 만든 뒤 담당자로 지정한다.
  //    생성 시 담당자를 함께 넣으면 created·assigned 두 이벤트가 모두 AI 를 실행시켜 코멘트가 두 번 달린다(WP-253).
  const types = await call(admin, 'GET', `/projects/${PROJECT_KEY}/types`);
  const taskType = types.find((t) => (t.code ?? t.key ?? t.name)?.toUpperCase() === 'TASK');
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const delegated = [];
  for (const t of TASKS) {
    const issue = await call(admin, 'POST', `/projects/${PROJECT_KEY}/issues`, {
      title: t.title,
      body: t.body,
      priority: 'MID',
      startDate: today,
      dueDate: due,
      typeId: taskType.typeId ?? taskType.id,
      parentNumber: 1,
    });
    await call(admin, 'PUT', `/projects/${PROJECT_KEY}/issues/${issue.number}/assignees`, { userIds: [agentId] });
    delegated.push(issue);
  }

  // 2) 이슈 AI 현황 요약 — 버그 이슈(MOB-7). 결과는 issue_ai_summary 에 저장돼 화면을 열면 보인다.
  await call(admin, 'POST', `/projects/${PROJECT_KEY}/issues/7/ai-summary`);
  console.log('✓ MOB-7 AI 현황 요약');

  // 3) 이슈 채팅에서 AI 에게 질문 — @멘션(<@id>)한 메시지만 AI 를 부른다.
  const thread = await call(admin, 'GET', `/projects/${PROJECT_KEY}/issues/7/chat/thread`);
  const threadId = thread.id ?? thread.threadId;
  await call(admin, 'POST', `/chat/threads/${threadId}/messages`, {
    body: `<@${agentId}> 이 버그 지금 어디까지 진행됐고, 베타 오픈 전에 남은 일이 뭔지 정리해 줄래요?`,
  });

  // 4) 채널에서 AI 에게 일 맡기기 — AI 가 스스로 이슈 생성 제안 카드를 올린다(승인은 촬영 때 화면에서 누른다).
  const channels = await call(admin, 'GET', '/messaging/channels');
  const main = (channels.content ?? channels).find((c) => c.name === '모바일-주문앱');
  await call(admin, 'POST', `/messaging/channels/${main.id}/messages`, {
    body:
      `<@${agentId}> 베타 테스터 피드백 중에 "재주문할 때 품절 상품이 왜 빠졌는지 모르겠다"는 의견이 많아요. ` +
      '품절 안내 문구 추가하는 작업 이슈로 만들어서 맡아줄래요?',
  });

  // 결과 대기
  await waitFor('채널 제안 카드', async () => {
    const page = await call(admin, 'GET', `/messaging/channels/${main.id}/messages?size=20`);
    return (page.content ?? page.items ?? page).some((m) => m.proposal);
  });
  await waitFor('이슈 채팅 AI 답변', async () => {
    const page = await call(admin, 'GET', `/chat/threads/${threadId}/messages`);
    return (page.content ?? page.items ?? page).some((m) => (m.author?.kind ?? m.authorKind) === 'AGENT');
  });
  await waitFor('위임 이슈 처리(코멘트)', async () => {
    for (const i of delegated) {
      const comments = await call(admin, 'GET', `/issues/${i.id}/comments`);
      if (comments.length < 2) return false;
    }
    return true;
  });

  console.log(JSON.stringify({ delegated: delegated.map((i) => i.number), threadId, channelId: main.id }));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
