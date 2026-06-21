// VirtualAttachmentPage.java
package com.workplace.drive.dto;

import java.util.List;

/** 커서 페이지네이션. nextCursor=null 이면 마지막 페이지. cursor 는 attachedAt(ISO-8601). */
public record VirtualAttachmentPage(List<VirtualAttachmentResponse> items, String nextCursor) {}
