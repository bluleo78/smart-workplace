package com.workplace.issue.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 외부 링크 추가·수정 요청(WP-887).
 *
 * <p>{@code url} 에는 {@code @NotBlank} 를 걸지 않는다 — 빈 값·비어 있는 주소도 검증 실패의 일반 오류가 아니라 서비스의 {@code
 * EXTERNAL_LINK_URL_INVALID} 로 답해 화면이 사유를 가를 수 있게 한다. 수정(PUT)은 주소를 바꾸지 않으므로 이 값을 무시한다.
 *
 * @param typeId 관계 유형 id
 * @param side 방향 있는 유형에서 이 이슈가 A 쪽({@code "source"}, 기본)인지 B 쪽({@code "target"})인지
 * @param url 추가 때만 쓰는 외부 주소(http/https)
 * @param key 상대 시스템의 키(선택, 1~50자)
 * @param title 제목(1~300자). 받을 때 한 줄로 다듬는다 — 보이지 않는 글자(제로폭 공백 등)만이면 빈 제목이 되어 「제목을 입력해 주세요」로 막힌다
 *     (WP-1107, 관계 카드에 ↗ 아이콘만 남았다)
 */
public record SaveIssueExternalLinkRequest(
    @NotNull Long typeId,
    String side,
    @Size(max = 2000) String url,
    @Size(max = 50) String key,
    @NotBlank(message = "제목을 입력해 주세요") @Size(max = 300) String title) {
  /**
   * 받을 때 제목·키를 한 줄로 다듬는다 — 검증(@NotBlank·@Size)이 다듬은 값을 재도록 생성자에서 한다. 보이지 않는 글자뿐인 제목은 빈 제목이 되어 막히고,
   * 키는 없는 키(null)가 된다(WP-1171).
   */
  public SaveIssueExternalLinkRequest {
    title = SingleLineTitles.normalize(title);
    key = SingleLineTitles.normalizeOptional(key);
  }
}
