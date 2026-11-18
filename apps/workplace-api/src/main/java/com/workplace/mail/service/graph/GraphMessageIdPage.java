package com.workplace.mail.service.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * Graph 메일함 메시지 id 목록 한 쪽(WP-1682 — 휴지통 비우기의 id 스냅샷, {@code GET
 * /me/mailFolders/deleteditems/messages?$select=id}). 다음 쪽이 있으면 {@code @odata.nextLink} 가 실리고, 마지막
 * 쪽에는 없다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GraphMessageIdPage(
    List<Item> value,
    /** 다음 쪽 절대 URL — 마지막 쪽이면 null. */
    @JsonProperty("@odata.nextLink") String nextLink) {

  /** 메시지 한 건 — id 만 받는다. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Item(String id) {}
}
