// DriveLinkResponse.java
package com.workplace.drive.dto;

import java.time.Instant;

/** 이슈/메시지에 걸린 드라이브 링크 1건. availability: ACTIVE|TRASHED|DELETED. */
public record DriveLinkResponse(
    long driveFileId,
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    boolean hasThumbnail,
    long spaceId,
    String spaceName,
    String availability,
    long createdById,
    Instant createdAt) {}
