package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** parentId NULL = 공간 루트에 생성. */
public record CreateFolderRequest(Long parentId, @NotBlank @Size(max = 255) String name) {}
