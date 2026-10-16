"""들어오는 요청을 Internal 토큰으로 검증(워커 auth.py·ai-agent internalAuth 와 동일 로직)."""
import hmac
from fastapi import Header, HTTPException
from . import config


def require_internal(authorization: str = Header(default="")) -> None:
    """`Authorization: Internal <토큰>` 이 아니면 401. 타이밍 공격 방지를 위해 상수 시간 비교."""
    scheme = "Internal "
    if not authorization.startswith(scheme) or not hmac.compare_digest(
            authorization[len(scheme):], config.INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")
