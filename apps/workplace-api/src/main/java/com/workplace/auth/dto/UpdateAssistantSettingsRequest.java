package com.workplace.auth.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 비서 설정 변경 요청 — 개인/공용 공통.
 *
 * <p>보낸 필드만 바꾼다: JSON 에 키가 없으면 변경 없음, 명시적 null 이면 디폴트(추천 모델은 자동)로 되돌림. record 는 "키 없음"과 "null" 을
 * 구분하지 못해 모델만 바꿔도 생각의 깊이·추천 모델이 지워졌다(WP-139) — Jackson 이 키가 있을 때만 setter 를 부르는 성질로 구분한다.
 */
public class UpdateAssistantSettingsRequest {

  private String model;

  @Pattern(regexp = "NONE|NORMAL|DEEP")
  private String thinkingDepth;

  /** 추천 질문 전용 모델(WP-139). assistant_config.suggestion_model 폭(64)과 같다. */
  @Size(max = 64)
  private String suggestionModel;

  private boolean modelPresent;
  private boolean thinkingDepthPresent;
  private boolean suggestionModelPresent;

  public String model() {
    return model;
  }

  public String thinkingDepth() {
    return thinkingDepth;
  }

  public String suggestionModel() {
    return suggestionModel;
  }

  /** 요청에 model 키가 있었는가. */
  public boolean hasModel() {
    return modelPresent;
  }

  /** 요청에 thinkingDepth 키가 있었는가. */
  public boolean hasThinkingDepth() {
    return thinkingDepthPresent;
  }

  /** 요청에 suggestionModel 키가 있었는가. */
  public boolean hasSuggestionModel() {
    return suggestionModelPresent;
  }

  public void setModel(String model) {
    this.model = model;
    this.modelPresent = true;
  }

  public void setThinkingDepth(String thinkingDepth) {
    this.thinkingDepth = thinkingDepth;
    this.thinkingDepthPresent = true;
  }

  public void setSuggestionModel(String suggestionModel) {
    this.suggestionModel = suggestionModel;
    this.suggestionModelPresent = true;
  }
}
