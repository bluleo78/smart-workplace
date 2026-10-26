package com.workplace.version.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** 버전 추가 요청(WP-888). 이름 1~40자, 설명 0~500자, 시작일·출시 예정일은 선택(둘 다 있으면 시작일 &lt;= 출시일 — 서비스가 검증). */
public record CreateVersionRequest(
    @NotBlank(message = "버전 이름을 입력해 주세요") @Size(max = 40, message = "버전 이름은 40자까지 입력할 수 있습니다")
        String name,
    @Size(max = 500, message = "설명은 500자까지 입력할 수 있습니다") String description,
    LocalDate startDate,
    LocalDate releaseDate) {
  public CreateVersionRequest {
    // 이름은 한 줄로 다듬는다(NFC·앞뒤 공백) — 같은 이름이 공백 차이로 둘이 되지 않게. 설명은 앞뒤 공백을 걷고 비면 없는 것으로 본다.
    name = SingleLineTitles.normalize(name);
    description = description == null || description.isBlank() ? null : description.strip();
  }
}
