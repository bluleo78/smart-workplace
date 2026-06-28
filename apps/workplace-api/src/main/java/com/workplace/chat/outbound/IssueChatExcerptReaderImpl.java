package com.workplace.chat.outbound;

import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.issue.outbound.IssueChatExcerptReader;
import com.workplace.issue.outbound.dto.ChatExcerpt;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * {@link IssueChatExcerptReader} 의 chat 모듈 구현. 이슈의 채팅 스레드를 찾아 최근 메시지를 요약 입력 형태로 변환한다. chat→issue
 * 의존만 사용하므로 순환이 생기지 않는다.
 */
@Component
@RequiredArgsConstructor
public class IssueChatExcerptReaderImpl implements IssueChatExcerptReader {

  private final ChatThreadRepository threadRepo;
  private final ChatMessageRepository messageRepo;

  /**
   * issueId 에 연결된 채팅 스레드의 최근 메시지를 오름차순으로 반환한다. 스레드가 없으면 빈 리스트를 반환한다.
   *
   * @param issueId 이슈 ID
   * @param limit 최대 메시지 수
   */
  @Override
  public List<ChatExcerpt> recentForIssue(long issueId, int limit) {
    return threadRepo
        .findIdByIssueId(issueId)
        .map(
            threadId ->
                messageRepo.findForSummary(threadId, limit).stream()
                    .map(
                        m ->
                            new ChatExcerpt(
                                m.authorName(), m.authorKind(), m.body(), m.createdAt()))
                    .toList())
        .orElseGet(List::of);
  }
}
