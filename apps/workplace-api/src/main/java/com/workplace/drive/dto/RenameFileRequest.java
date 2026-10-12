package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 드라이브 파일 이름 변경 요청(WP-335). 금지 문자·"."/".." 검사는 앞뒤 공백을 지운 뒤 DriveFileService 가 한곳에서 한다. */
public record RenameFileRequest(@NotBlank @Size(max = 255) String name) {}
