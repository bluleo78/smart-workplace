package com.workplace.component.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Size;

/**
 * 구성요소 부분 수정 요청(WP-933) — 보낸(null 이 아닌) 필드만 바꾼다.
 *
 * <ul>
 *   <li>name — 보내면 1~40자(다듬은 뒤)
 *   <li>description — 보내면 교체, 빈 문자열이면 지운다
 *   <li>defaultAssigneeId — 보내면 그 사람으로 교체, 지우려면 {@code clearDefaultAssignee=true}
 *   <li>archived — true 보관, false 복원
 * </ul>
 */
public record UpdateComponentRequest(
    @Size(min = 1, max = 40, message = "구성요소 이름은 1자 이상 40자 이하로 입력해 주세요") String name,
    @Size(max = 200, message = "설명은 200자까지 입력할 수 있습니다") String description,
    Long defaultAssigneeId,
    Boolean clearDefaultAssignee,
    Boolean archived) {
  public UpdateComponentRequest {
    // 이름·설명 다듬기는 추가 요청과 같다. 이름을 보냈는데 다듬어 비면 1자 이상 검증이 거절한다.
    name = name == null ? null : SingleLineTitles.normalize(name);
    description = description == null ? null : description.strip();
  }

  /** 담당자를 지정하면서 동시에 지우라는 모순된 요청은 거절한다. */
  @AssertTrue(message = "담당자를 지정하는 동시에 지울 수 없습니다")
  public boolean isAssigneeRequestConsistent() {
    return !(defaultAssigneeId != null && Boolean.TRUE.equals(clearDefaultAssignee));
  }
}
