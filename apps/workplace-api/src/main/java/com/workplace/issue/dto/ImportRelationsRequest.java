package com.workplace.issue.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 관계 일괄 가져오기(WP-887) 요청 본문 — 이슈를 모두 가져온 뒤 이슈 사이 관계를 한 번에 넣는다. 한 줄은 「from 이 type 의 A 쪽, 상대가 B 쪽」이다.
 * 방향 없는 유형은 서버가 순서를 정규화하므로 어느 쪽을 from 으로 보내도 된다.
 */
public record ImportRelationsRequest(
    @NotEmpty(message = "관계는 1건 이상이어야 합니다.")
        @Size(max = MAX_RELATIONS, message = "관계는 1,000건 이하여야 합니다.")
        List<@NotNull(message = "관계 항목은 비울 수 없습니다.") @Valid Item> relations) {

  /** 한 요청의 관계 상한. */
  public static final int MAX_RELATIONS = 1000;

  /**
   * 관계 한 줄. 상대는 {@code toNumber}(이 프로젝트 번호)와 {@code toKey}(예: {@code WPV-28}, 다른 프로젝트 포함) 중 정확히 하나로
   * 준다 — 둘 다 있거나 둘 다 없으면 그 줄은 오류다(서비스가 줄별로 알린다).
   *
   * @param type 관계 유형 코드(기본 유형, 정확 일치) 또는 사용자 정의 유형 이름
   * @param from 이 프로젝트의 A 쪽 이슈 번호
   */
  public record Item(
      @NotBlank(message = "관계 유형은 필수입니다.") String type,
      @NotNull(message = "from 은 필수입니다.") @Positive(message = "from 은 1 이상이어야 합니다.") Integer from,
      @Positive(message = "toNumber 는 1 이상이어야 합니다.") Integer toNumber,
      String toKey) {}
}
