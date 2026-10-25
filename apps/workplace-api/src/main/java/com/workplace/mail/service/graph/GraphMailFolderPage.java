package com.workplace.mail.service.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * Graph {@code /me/mailFolders}·{@code childFolders} 응답 한 페이지(WP-960). 다음 페이지가 있으면 nextLink 가 있다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GraphMailFolderPage(
    List<GraphMailFolder> value,
    /** 다음 페이지 절대 URL — 마지막 페이지면 null. */
    @JsonProperty("@odata.nextLink") String nextLink) {}
