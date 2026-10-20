package com.workplace.user.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 그룹 부분 수정 요청(#839). visibility 는 변경 불가(생성 시 고정). #858 {@code UpdateProjectRequest} 와 같은 규칙으로 null
 * 필드는 "변경 없음"이다 — 이전엔 전체 교체라 이름만 보내면 parentId=null 로 최상위로 튀어나가고 code 가 지워졌다.
 *
 * <p>null 과 "비우기"를 구분하려고 플래그를 둔다: 최상위로 옮기려면 {@code moveToRoot=true}, 코드를 비우려면 {@code
 * clearCode=true}. 값과 플래그를 동시에 주면(parentId+moveToRoot, code+clearCode) 모호하므로 400 이다. name 은 보낼 때만
 * 공백이 아니어야 한다.
 */
public record UpdateUserGroupRequest(
    @Size(max = 100) @Pattern(regexp = "(?s).*\\S.*", message = "이름은 비워 둘 수 없습니다.") String name,
    Long parentId,
    Boolean moveToRoot,
    @Size(max = 64) String code,
    Boolean clearCode,
    Integer sortOrder) {
  public UpdateUserGroupRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
