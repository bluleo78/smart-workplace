"""Internal 토큰 — 들어오는 요청 검증(ai-agent internalAuth 미러)과 나가는 호출의 헤더."""
import hmac
from fastapi import Header, HTTPException
from . import config


def require_internal(authorization: str = Header(default="")) -> None:
    scheme = "Internal "
    if not authorization.startswith(scheme) or not hmac.compare_digest(
            authorization[len(scheme):], config.INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


def internal_headers() -> dict[str, str]:
    """워커가 api·converter 를 호출할 때 붙이는 Internal 인증 헤더."""
    return {"Authorization": f"Internal {config.INTERNAL_TOKEN}"}
