from typing import Literal

from pydantic import BaseModel, Field


# 语音配置，对应 vox-data.json 中的 voices 字段
class VoiceConfig(BaseModel):
    prompt_text: str
    prompt_wav_path: str
    reference_wav_path: str


# Speaker 信息
class Speaker(BaseModel):
    id: int
    name: str | None = None
    description: str | None = None
    icon_url: str | None = None


# 创建语音生成任务的请求体
class CreateJobRequest(BaseModel):
    speaker_id: int
    text: str = Field(..., max_length=4096)


# 任务完整信息（用于单个任务查询和内部逻辑）
class Job(BaseModel):
    id: str
    speaker_id: int
    text: str
    status: str = "pending"  # pending / running / completed / failed
    created_at: str
    created_ip: str | None = None
    result_key: str | None = None
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: float | None = None


# 任务列表项（用于列表接口，附带 speaker 名称和头像）
class JobListItem(BaseModel):
    id: str
    created_at: str
    status: str
    text: str
    speaker_id: int
    speaker_name: str | None = None
    speaker_icon_url: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: float | None = None


class ReadinessChecks(BaseModel):
    database: bool
    model: bool
    worker: bool


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks


class WorkerStatus(BaseModel):
    alive: bool
    busy: bool
    current_job_id: str | None
    queue_size: int


class LoginRequest(BaseModel):
    username: str = Field(..., max_length=32)
    password: str = Field(..., max_length=128)


class UserPublic(BaseModel):
    id: int
    username: str
    role: Literal["admin", "user"]
    is_active: bool
    created_at: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"]
    expires_at: str
    user: UserPublic


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(..., min_length=8, max_length=128)
    role: Literal["admin", "user"] = "user"


class UpdateUserRequest(BaseModel):
    role: Literal["admin", "user"] | None = None
    is_active: bool | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class ResetPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)
