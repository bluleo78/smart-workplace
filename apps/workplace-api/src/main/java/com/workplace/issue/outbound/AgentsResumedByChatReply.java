package com.workplace.issue.outbound;

import java.util.List;

/**
 * 사람의 이슈 챗 글로 답변 필요(INPUT_REQUIRED)에서 작업 중으로 되돌린 AI 들(WP-1067). notify 가 커밋 뒤 받아 그 AI 들에게 알림을 만든다 —
 * 외부 AI 는 이 알림(SSE notify.created)으로만 바로 깨어나는데, 질문에 답하는 사람은 멘션을 붙이지 않기 때문이다.
 *
 * <p>되돌리는 쪽(issue)이 바꾼 행의 작업자를 그대로 싣는다 — 알림은 커밋 뒤 비동기로 돌아 그때는 이미 작업 중이라, notify 가 「기다리던 AI」를 다시
 * 조회해서는 찾을 수 없다. 글에서 멘션된 AI 는 멘션 알림을 이미 받으므로 뺀다(한 AI 에 1건).
 *
 * @param actorId 챗 글 작성자(사람)
 * @param workerIds 되돌린 AI 작업자 id(멘션된 AI 제외, 비어 있지 않다)
 */
public record AgentsResumedByChatReply(long issueId, long actorId, List<Long> workerIds) {}
