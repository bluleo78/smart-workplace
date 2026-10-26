package com.workplace.version.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 버전 부분 수정 요청(WP-888) — 보낸(null 이 아닌) 필드만 바꾼다.
 *
 * <ul>
 *   <li>name — 보내면 1~40자(다듬은 뒤)
 *   <li>description — 보내면 교체, 빈 문자열이면 지운다(또는 {@code clearDescription=true})
 *   <li>startDate·releaseDate — 보내면 교체, 지우려면 {@code clearStartDate}·{@code clearReleaseDate}
 *   <li>archived — true 보관, false 복원(출시 상태는 그대로)
 * </ul>
 */
public record UpdateVersionRequest(
    @Size(min = 1, max = 40, message = "버전 이름은 1자 이상 40자 이하로 입력해 주세요") String name,
    @Size(max = 500, message = "설명은 500자까지 입력할 수 있습니다") String description,
    Boolean clearDescription,
    LocalDate startDate,
    Boolean clearStartDate,
    LocalDate releaseDate,
    Boolean clearReleaseDate,
    Boolean archived) {
  public UpdateVersionRequest {
    name = name == null ? null : SingleLineTitles.normalize(name);
    description = description == null ? null : description.strip();
  }

  /** 값을 지정하면서 동시에 지우라는 모순된 요청은 거절한다. */
  @AssertTrue(message = "값을 지정하는 동시에 지울 수 없습니다")
  public boolean isClearRequestConsistent() {
    return !(description != null && Boolean.TRUE.equals(clearDescription))
        && !(startDate != null && Boolean.TRUE.equals(clearStartDate))
        && !(releaseDate != null && Boolean.TRUE.equals(clearReleaseDate));
  }
}
