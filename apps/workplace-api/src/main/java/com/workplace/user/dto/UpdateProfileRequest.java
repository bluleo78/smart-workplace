package com.workplace.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 프로필 수정 요청 DTO. name 길이 상한을 서버에서도 검사해 프론트엔드 우회 시에도 400 을 반환한다(#26). WP-569: 상한은 DB 컬럼({@code
 * user.name VARCHAR(50)})·구성원 추가(CreateMemberRequest)와 같은 50자 — 100자로 두면 51~100자가 DB 에서 영어 409 로
 * 샜다.
 */
public record UpdateProfileRequest(
    @NotBlank @Size(max = 50, message = "이름은 50자까지 쓸 수 있습니다") String name, @Email String email) {}
