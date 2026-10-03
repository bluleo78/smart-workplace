package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** thread id → 이슈/프로젝트 컨텍스트 resolve (이벤트 payload + 권한 체크용). */
@Component
@RequiredArgsConstructor
public class ChatThreadContextResolver {

  private final DSLContext dsl;

  public Context resolve(long threadId) {
    // #368: 이슈 채팅 AI 가 이슈 컨텍스트를 인지하도록 title·status·body 까지 함께 resolve 한다.
    // 이 조회는 메시지 작성자(사람=프로젝트 멤버)의 트랜잭션에서 실행되므로 권한 문제 없이 본문을 읽는다 —
    // AGENT 는 비멤버라 get_issue_detail 로 직접 못 읽는다(이벤트 payload 로 미리 주입하는 이유).
    return dsl.select(
            ISSUE.ID,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.STATUS,
            ISSUE.BODY,
            ISSUE.REPORTER_ID,
            PROJECT.ID,
            PROJECT.KEY)
        .from(CHAT_THREAD)
        .join(ISSUE)
        .on(ISSUE.ID.eq(CHAT_THREAD.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(CHAT_THREAD.ID.eq(threadId))
        .fetchOne(
            r ->
                new Context(
                    r.get(ISSUE.ID),
                    r.get(PROJECT.ID),
                    r.get(PROJECT.KEY),
                    r.get(PROJECT.KEY) + "-" + r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    r.get(ISSUE.STATUS),
                    r.get(ISSUE.BODY),
                    r.get(ISSUE.REPORTER_ID)));
  }

  public record Context(
      long issueId,
      long projectId,
      String projectKey,
      String issueKey,
      String issueTitle,
      String issueStatus,
      String issueBody,
      // WP-213: 이슈 토크 작성 권한(댓글과 동일 규칙 — OPEN 프로젝트 reporter 본인 허용) 판정용.
      Long reporterId) {

    /** issueKey("WP-12") 의 마지막 '-' 뒤 숫자 = 이슈 번호. */
    public int issueNumber() {
      return Integer.parseInt(issueKey.substring(issueKey.lastIndexOf('-') + 1));
    }
  }
}
