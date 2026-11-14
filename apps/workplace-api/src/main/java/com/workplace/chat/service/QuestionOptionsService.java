package com.workplace.chat.service;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageOptionsEvent;
import com.workplace.chat.outbound.ChatMessageOrigin;
import com.workplace.chat.outbound.QuestionOptionsExtractor;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.util.MentionParser;
import com.workplace.global.util.QuestionOptions;
import com.workplace.global.util.Texts;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AI 질문 글의 답 선택지 보완 추출(WP-1569). report_agent_work 가 options 없이 질문을 올리면, 질문 글이 커밋된 뒤 포트 {@link
 * QuestionOptionsExtractor}(home 구현 — 비서 해석 + ai-agent mode=answer)로 사람이 고를 답 선택지를 뽑고, 2개 이상이면 저장한
 * 뒤 SSE {@code chat.message.options} 로 스레드 멤버에게 알린다. 웹은 열린 질문 아래 「빠른 답변」 칩으로 보인다.
 *
 * <p>없어도 되는 부가 기능이라 실패·시간 초과·빈 결과·비서 없음은 아무것도 하지 않는다 — 질문 글과 보고는 이미 커밋됐다.
 *
 * <p>켜기/끄기: 사용자별 「AI 추천 사용」 설정은 보지 않는다 — 칩은 질문 글에 저장돼 그 챗을 보는 모두가 함께 보므로 한 사람의 설정으로 정할 수 없다.
 * 워크스페이스·프로젝트 단위 AI 추천 설정은 아직 없어 연결된 비서가 있느냐로만 정한다(구현 쪽 주석 참고).
 *
 * <p>스레드·트랜잭션: 커밋 뒤(AFTER_COMMIT) 요청 스레드에서 전용 {@code questionOptionsExecutor}(TenantContext 전파
 * 데코레이터, 짧은 큐·넘치면 버림)에 제출만 하고 곧바로 돌아온다 — 보고 응답을 붙잡지 않는다. 실행기 스레드는 트랜잭션 없이 포트를 부르고(포트가 비서 해석만 짧은
 * 트랜잭션으로, ai-agent HTTP 는 트랜잭션 밖에서 한다), 저장만 짧은 트랜잭션으로 한다.
 */
@Slf4j
@Service
public class QuestionOptionsService {

  /**
   * 질문 글 앞부분만 보낸다 — 고를 선택지는 대개 글 안에 있고, 반복 회차 질문처럼 긴 글이 내부 요청 본문을 키우지 않게. ai-agent zod 의 question
   * 상한(2만 자)보다 작다.
   */
  static final int QUESTION_MAX_CHARS = 4_000;

  private final ChatMessageRepository messageRepo;
  private final QuestionOptionsExtractor extractor;
  private final ApplicationEventPublisher publisher;
  private final TransactionTemplate txTemplate;
  private final AsyncTaskExecutor executor;

  public QuestionOptionsService(
      ChatMessageRepository messageRepo,
      QuestionOptionsExtractor extractor,
      ApplicationEventPublisher publisher,
      PlatformTransactionManager txManager,
      @Qualifier("questionOptionsExecutor") AsyncTaskExecutor executor) {
    this.messageRepo = messageRepo;
    this.extractor = extractor;
    this.publisher = publisher;
    this.txTemplate = new TransactionTemplate(txManager);
    this.executor = executor;
  }

  /**
   * 질문 글 커밋 뒤 — 선택지 없이 올라온 AI 질문이면 실행기에 추출을 맡긴다. 보고와 함께 선택지가 왔거나 질문이 아니면 아무것도 하지 않는다. 제출 실패(큐 포화
   * 등)는 삼킨다 — 커밋 뒤라 보고 응답에 영향이 없어야 한다.
   */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(ChatMessageCreatedEvent e) {
    if (!needsExtraction(e)) return;
    String question = Texts.headUtf16(questionText(e.body(), e.mentions()), QUESTION_MAX_CHARS);
    try {
      executor.execute(() -> extract(e.threadId(), e.messageId(), e.projectKey(), question));
    } catch (TaskRejectedException ex) {
      // 큐 포화 — 부가 기능이라 기다리지 않고 버린다.
      log.debug("질문 선택지 추출 큐 포화 — 버림: message={}", e.messageId());
    } catch (RuntimeException ex) {
      log.warn("질문 선택지 추출 예약 실패: message={} {}", e.messageId(), ex.getMessage());
    }
  }

  /** 추출 대상 — 보고 경로의 AI 질문 글이고, 선택지가 아직 없고, 본문이 있다. */
  static boolean needsExtraction(ChatMessageCreatedEvent e) {
    return e.origin() == ChatMessageOrigin.REPORT_QUESTION
        && e.options() == null
        && e.body() != null
        && !e.body().isBlank();
  }

  /**
   * LLM 에 보낼 질문 글 — 멘션 토큰({@code <@123>})을 {@code @이름} 으로 바꾼다. 토큰 그대로면 모델이 숫자를 선택지에 옮기거나 누구를 말하는지
   * 모른다. 이름은 생성 이벤트에 이미 hydrate 된 mentions 에서, 없으면(탈퇴 등) {@code @사용자} — 푸시 미리보기와 같은 표기라 {@link
   * MentionParser#replaceWithNames(String, Map)} 를 그대로 쓴다.
   */
  static String questionText(String body, List<UserSummary> mentions) {
    Map<Long, String> names = new HashMap<>();
    if (mentions != null) {
      for (UserSummary u : mentions) {
        if (u.id() != null && u.name() != null) names.putIfAbsent(u.id(), u.name());
      }
    }
    return MentionParser.replaceWithNames(body, names);
  }

  /**
   * 실행기 스레드 — 포트로 추출(트랜잭션 밖) → 정리 → (아직 선택지가 없는 질문 글이면) 저장 + 이벤트. 어떤 실패도 로그만 남긴다.
   *
   * <p>패키지 가시성 — 테스트가 실행기를 거치지 않고 직접 부른다(TenantContext 를 세운 뒤).
   */
  void extract(long threadId, long messageId, String projectKey, String question) {
    try {
      List<String> options = QuestionOptions.fromExtracted(extractor.extract(projectKey, question));
      if (options.isEmpty()) return;
      // 저장과 이벤트를 한 트랜잭션에 — SSE 디스패처가 커밋 직전에 같은 커넥션으로 수신자(스레드 멤버)를 읽고 커밋 뒤에만 보낸다.
      txTemplate.executeWithoutResult(
          s -> {
            if (messageRepo.fillOptionsIfAbsent(messageId, options) == 1) {
              publisher.publishEvent(new ChatMessageOptionsEvent(threadId, messageId, options));
            }
          });
    } catch (RuntimeException ex) {
      // 부가 기능 — DB 오류 등도 버리되 원인을 볼 수 있게 남긴다.
      log.warn("질문 선택지 추출·저장 실패: message={}", messageId, ex);
    }
  }
}
