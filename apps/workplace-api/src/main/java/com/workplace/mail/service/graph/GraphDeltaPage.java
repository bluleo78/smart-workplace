package com.workplace.mail.service.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * Microsoft Graph messages/delta 응답 페이지. 마지막 페이지에는 {@code @odata.nextLink} 가 없고 {@code
 * @odata.deltaLink} 가 포함된다. 이전 페이지에는 {@code @odata.nextLink} 만 있다.
 *
 * <p>페이징: {@code nextLink != null}이면 다음 페이지, {@code deltaLink != null}이면 최종 페이지(커서 보관).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GraphDeltaPage(
    List<GraphMessage> value,
    /** 다음 페이지 절대 URL — 없으면 null. */
    @JsonProperty("@odata.nextLink") String nextLink,
    /** 증분 커서 절대 URL — 마지막 페이지에만 존재. */
    @JsonProperty("@odata.deltaLink") String deltaLink) {}
