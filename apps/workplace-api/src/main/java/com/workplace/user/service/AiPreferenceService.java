package com.workplace.user.service;

import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 AI 사용 설정(WP-139) — 추천 질문 켜기/끄기. 홈 채팅(빈 대화 추천·후속 질문 생성·이력 표시)이 이 값을 본다.
 *
 * <p>"user" 는 RLS 비대상이라 어느 스레드(후속 질문 실행기 포함)에서 불러도 같은 결과다.
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

  /** 추천 질문 켜기/끄기 저장. */
  @Transactional
  public void update(long userId, boolean enabled) {
    userRepository.updateAiSuggestionsEnabled(userId, enabled);
  }
}
