package com.workplace.mail.service.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Microsoft Graph {@code mailFolder} 한 항목(WP-960 서버 메일함 목록). 검색 폴더({@code mailSearchFolder})는 같은
 * 목록에 {@code @odata.type} 으로 섞여 오므로 그 값을 함께 받아 거른다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GraphMailFolder(
    String id,
    String displayName,
    String parentFolderId,
    Integer childFolderCount,
    Integer unreadItemCount,
    Integer totalItemCount,
    /** 숨김 폴더 여부 — is- 접두 레코드 컴포넌트라 JSON 키를 명시한다. */
    @JsonProperty("isHidden") Boolean isHidden,
    /** 파생 형식 표시(예: {@code #microsoft.graph.mailSearchFolder}) — 일반 폴더면 보통 없음. */
    @JsonProperty("@odata.type") String odataType) {

  /** 검색 폴더 형식 값. */
  public static final String SEARCH_FOLDER_TYPE = "#microsoft.graph.mailSearchFolder";

  /** 검색 폴더(실제 메일함이 아닌 저장된 검색)인지. */
  public boolean isSearchFolder() {
    return SEARCH_FOLDER_TYPE.equals(odataType);
  }
}
