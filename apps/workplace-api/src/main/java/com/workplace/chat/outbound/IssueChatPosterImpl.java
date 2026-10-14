package com.workplace.chat.outbound;

import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.issue.outbound.IssueChatPoster;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** {@link IssueChatPoster} 의 chat 모듈 구현 — 이슈 챗 스레드(없으면 생성)에 호출자 이름으로 보고 글을 올린다. */
@Component
@RequiredArgsConstructor
public class IssueChatPosterImpl implements IssueChatPoster {

  private final ChatThreadService threadService;
  private final ChatMessageService messageService;

  @Override
  public long post(
      long callerId, String projectKey, int issueNumber, String body, boolean question) {
    long threadId = threadService.getOrCreate(callerId, projectKey, issueNumber).threadId();
    return messageService.createFromReport(callerId, threadId, body, question).id();
  }
}
