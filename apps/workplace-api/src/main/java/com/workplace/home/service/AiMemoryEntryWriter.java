package com.workplace.home.service;

import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.ai.AiMemoryWriter;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.exception.AiMemoryException;
import com.workplace.user.service.AiPreferenceService;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * {@link AiMemoryWriter} 구현(WP-1341) — AI 대행(internal=true) 경로로 {@link AiMemoryService} 에 쓴다. 그래서
 * 꺼짐(409)·상한·길이 규칙이 홈 AI 비서의 remember_memory·update_memory 와 같다. 규칙 위반·없음은 {@link Optional#empty()}
 * 로 바꾼다(메모리는 부가 기능 — 학습 실패가 사용자 동작 실패가 되지 않게).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiMemoryEntryWriter implements AiMemoryWriter {

  /** 메일 분류 교정 기억의 종류 — 사용자가 알려 준 선호·교정. */
  static final String KIND = AiMemoryService.KIND_PREFERENCE;

  /** 메일 분류 교정 기억의 범위 — 메일(리더가 읽는 범위 상수와 같은 값 하나). */
  static final String SCOPE = AiMemoryReader.MAIL;

  private final AiMemoryService memoryService;
  private final AiPreferenceService preferences;

  @Override
  public boolean enabled(long userId) {
    return preferences.memoryEnabled(userId);
  }

  @Override
  public Optional<Saved> createMailRule(long userId, String content) {
    try {
      AiMemoryItem item =
          memoryService.create(
              userId,
              new CreateAiMemoryRequest(
                  KIND, content, AiMemoryService.SOURCE_AI, null, SCOPE, null),
              true);
      return Optional.of(new Saved(item.id(), item.content(), null));
    } catch (AiMemoryException e) {
      log.warn("메일 분류 기억 만들기 건너뜀: user={} {}", userId, e.getMessage());
      return Optional.empty();
    }
  }

  @Override
  public Optional<Saved> updateContent(long userId, long memoryId, String content) {
    UpdateAiMemoryRequest req = new UpdateAiMemoryRequest();
    req.setContent(content);
    try {
      AiMemoryItem item = memoryService.update(userId, memoryId, req, true);
      return Optional.of(new Saved(item.id(), item.content(), item.previousContent()));
    } catch (AiMemoryException e) {
      log.warn("메일 분류 기억 고치기 건너뜀: user={} memory={} {}", userId, memoryId, e.getMessage());
      return Optional.empty();
    }
  }
}
