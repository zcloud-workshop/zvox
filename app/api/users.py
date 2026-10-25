import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.models.schemas import (
    ApiKeyPublic,
    ChangePasswordRequest,
    CreateApiKeyRequest,
    CreateApiKeyResponse,
    CreateUserRequest,
    LoginRequest,
    LoginResponse,
    ResetPasswordRequest,
    UpdateUserRequest,
    UserPublic,
)
from app.services import user as user_service
from app.services.login_rate_limit import LoginRateLimitExceeded

router = APIRouter(prefix="/api", tags=["users"])
bearer = HTTPBearer(auto_error=False, description="登录返回的 access_token 或 API Key")


async def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    user = await asyncio.to_thread(user_service.get_user_for_token, credentials.credentials)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


async def require_session_user(user: dict = Depends(get_current_user)) -> dict:
    # 泄露的 API Key 不能用来创建新 Key, 撤销其他 Key 或尝试当前密码.
    if user.get("api_key_id") is not None:
        raise HTTPException(status_code=403, detail="Login session required")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post(
    "/auth/login",
    response_model=LoginResponse,
    responses={429: {"description": "Too many login attempts", "headers": {"Retry-After": {"schema": {"type": "integer"}}}}},
)
async def login(req: LoginRequest, request: Request):
    try:
        request.app.state.login_limiter.check(req.username, request.client.host if request.client else None)
    except LoginRateLimitExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after)}) from exc
    result = await asyncio.to_thread(user_service.login, req.username, req.password)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return result


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer), user: dict = Depends(require_session_user)
):
    await asyncio.to_thread(user_service.logout, credentials.credentials)
    return Response(status_code=204)


@router.get("/users/me", response_model=UserPublic)
async def get_me(user: dict = Depends(get_current_user)):
    return user


@router.post("/users/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(req: ChangePasswordRequest, user: dict = Depends(require_session_user)):
    changed = await asyncio.to_thread(user_service.change_password, user["id"], req.current_password, req.new_password)
    if not changed:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    return Response(status_code=204)


@router.get("/users/me/api-keys", response_model=list[ApiKeyPublic])
async def list_api_keys(user: dict = Depends(require_session_user)):
    return await asyncio.to_thread(user_service.list_api_keys, user["id"])


@router.post("/users/me/api-keys", response_model=CreateApiKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    req: CreateApiKeyRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    user: dict = Depends(require_session_user),
):
    try:
        key = await asyncio.to_thread(
            user_service.create_api_key, user["id"], credentials.credentials, req.name, req.expires_in_days
        )
    except ValueError as exc:
        raise HTTPException(status_code=409 if str(exc) == "API key limit reached" else 400, detail=str(exc)) from exc
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return key


@router.delete("/users/me/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(key_id: int, user: dict = Depends(require_session_user)):
    if not await asyncio.to_thread(user_service.revoke_api_key, user["id"], key_id):
        raise HTTPException(status_code=404, detail="API key not found")
    return Response(status_code=204)


@router.get("/admin/users", response_model=list[UserPublic])
async def list_users(admin: dict = Depends(require_admin)):
    return await asyncio.to_thread(user_service.list_users)


@router.post("/admin/users", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(req: CreateUserRequest, admin: dict = Depends(require_admin)):
    try:
        return await asyncio.to_thread(user_service.create_user, req.username, req.password, req.role)
    except ValueError as exc:
        raise HTTPException(status_code=409 if str(exc) == "Username already exists" else 400, detail=str(exc)) from exc


@router.patch("/admin/users/{user_id}", response_model=UserPublic)
async def update_user(user_id: int, req: UpdateUserRequest, admin: dict = Depends(require_admin)):
    if req.role is None and req.is_active is None:
        raise HTTPException(status_code=422, detail="No changes provided")
    try:
        user = await asyncio.to_thread(user_service.update_user, user_id, req.role, req.is_active)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/admin/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(user_id: int, req: ResetPasswordRequest, admin: dict = Depends(require_admin)):
    if not await asyncio.to_thread(user_service.reset_password, user_id, req.password):
        raise HTTPException(status_code=404, detail="User not found")
    return Response(status_code=204)
