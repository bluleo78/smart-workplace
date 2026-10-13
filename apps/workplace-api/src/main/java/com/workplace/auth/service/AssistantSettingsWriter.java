package com.workplace.auth.service;

import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 비서 설정 부분 갱신(WP-139) — 개인·공용 비서가 같은 병합 규칙을 쓴다. 요청에 있는 필드만 바꾸고 나머지(maxTurns·timeoutMs 포함)는 현재 값을
 * 보존한다. 호출자의 트랜잭션 안에서 실행된다.
 */
@Component
@RequiredArgsConstructor
class AssistantSettingsWriter {

  private final AssistantConfigRepository configRepo;

  /** agent 의 설정에 요청을 병합해 저장한다. 빈 문자열 추천 모델은 자동(null)으로 본다. */
  void apply(long agentId, UpdateAssistantSettingsRequest req) {
    ConfigRow cur = configRepo.find(agentId).orElse(new ConfigRow(null, null, null, null));
    String model = req.hasModel() ? req.model() : cur.model();
    String depth = req.hasThinkingDepth() ? req.thinkingDepth() : cur.thinkingDepth();
    configRepo.upsert(agentId, model, depth, cur.maxTurns(), cur.timeoutMs());
    if (req.hasSuggestionModel()) {
      String s = req.suggestionModel();
      configRepo.updateSuggestionModel(agentId, s == null || s.isBlank() ? null : s.strip());
    }
  }
}
