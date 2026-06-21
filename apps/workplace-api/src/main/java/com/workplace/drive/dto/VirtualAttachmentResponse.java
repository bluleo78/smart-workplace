// VirtualAttachmentResponse.java
package com.workplace.drive.dto;

import java.time.Instant;

public record VirtualAttachmentResponse(
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    boolean hasThumbnail,
    String sourceType,
    String sourceLabel,
    String deepLink,
    String downloadUrl,
    Instant attachedAt) {}
