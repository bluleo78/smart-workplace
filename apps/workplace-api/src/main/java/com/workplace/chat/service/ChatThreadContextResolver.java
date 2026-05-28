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
    return dsl.select(ISSUE.ID, ISSUE.NUMBER, PROJECT.ID, PROJECT.KEY)
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
                    r.get(PROJECT.KEY) + "-" + r.get(ISSUE.NUMBER)));
  }

  public record Context(long issueId, long projectId, String projectKey, String issueKey) {}
}
