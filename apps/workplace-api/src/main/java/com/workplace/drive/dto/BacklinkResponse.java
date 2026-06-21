// BacklinkResponse.java
package com.workplace.drive.dto;

public record BacklinkResponse(String sourceType, long sourceId, String label, String deepLink) {}
