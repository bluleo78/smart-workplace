package com.workplace.user.service;

import com.workplace.user.dto.AiPreferencesResponse;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 AI 사용 설정 — 추천 질문(WP-139)과 메모리(WP-55) 켜기/끄기. 홈 채팅(추천·후속 질문·메모리 주입)과 메모리 대행 쓰기가 이 값을 본다.
 *
 * <p>"user" 는 RLS 비대상이라 어느 스레드(후속 질문 실행기·채팅 펌프 포함)에서 불러도 같은 결과다.
 */
@Service
@RequiredArgsConstructor
public class AiPreferenceService {

  private final UserRepository userRepository;

  /** 추천 질문을 보일지 — 미설정이면 켜짐. */
  @Transactional(readOnly = true)
  public boolean suggestionsEnabled(long userId) {
    return userRepository.isAiSuggestionsEnabled(userId);
  }

  /** 메모리를 쓸지(WP-55) — 미설정이면 켜짐. 끄면 주입하지 않고 AI 대행 쓰기를 409 로 막는다. */
  @Transactional(readOnly = true)
  public boolean memoryEnabled(long userId) {
    return userRepository.isAiMemoryEnabled(userId);
  }

  /** 두 설정을 한 번에(설정 화면 조회·저장 응답) — 같은 행을 한 번만 읽는다. */
  @Transactional(readOnly = true)
  public AiPreferencesResponse current(long userId) {
    UserRepository.AiFlags f = userRepository.findAiFlags(userId);
    return new AiPreferencesResponse(f.suggestionsEnabled(), f.memoryEnabled());
  }

  /** 부분 저장 — null 인 값은 건드리지 않는다(present-flag, 판정 3). */
  @Transactional
  public void update(long userId, Boolean suggestionsEnabled, Boolean memoryEnabled) {
    if (suggestionsEnabled != null) {
      userRepository.updateAiSuggestionsEnabled(userId, suggestionsEnabled);
    }
    if (memoryEnabled != null) userRepository.updateAiMemoryEnabled(userId, memoryEnabled);
  }
}
