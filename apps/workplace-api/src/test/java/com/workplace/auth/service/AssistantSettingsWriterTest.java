package com.workplace.auth.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * WP-139 비서 설정 병합 — 어떤 저장 호출이 나가는지 본다. 통합 테스트로는 "같은 값으로 다시 쓰기"와 "안 쓰기"가 구분되지 않아 리포지토리를 목으로 둔다. 추천
 * 모델만 보내면 model/depth 행을 다시 쓰지 않아야 동시 PUT 의 read-modify-write 덮어쓰기 창이 생기지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class AssistantSettingsWriterTest {

  @Mock AssistantConfigRepository configRepo;
  @InjectMocks AssistantSettingsWriter writer;

  @Test
  void 추천_모델만_보내면_모델과_깊이는_다시_쓰지_않는다() {
    var req = new UpdateAssistantSettingsRequest();
    req.setSuggestionModel("claude-haiku-5-5");

    writer.apply(7L, req);

    verify(configRepo).updateSuggestionModel(7L, "claude-haiku-5-5");
    verify(configRepo, never()).upsert(anyLong(), any(), any(), any(), any());
  }

  @Test
  void 모델을_보내면_깊이와_튜닝_값을_보존해_쓴다() {
    when(configRepo.find(7L))
        .thenReturn(Optional.of(new ConfigRow("old", "DEEP", 12, 90_000, "claude-haiku-5-5")));
    var req = new UpdateAssistantSettingsRequest();
    req.setModel("claude-opus-5-5");

    writer.apply(7L, req);

    verify(configRepo).upsert(7L, "claude-opus-5-5", "DEEP", 12, 90_000);
    verify(configRepo, never()).updateSuggestionModel(anyLong(), any());
  }
}
