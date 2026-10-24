# API 接口文档

所有接口前缀为 `/api`.

## 认证与用户管理

首次部署运行 `uv run python -m app.tools.create_admin admin`, 交互式设置管理员密码. 创建账号、修改和重置密码均要求 8-128 个字符. 此后仅管理员可创建其他账号, 不提供自助注册.

```text
POST /api/auth/login
Content-Type: application/json

{"username": "admin", "password": "<password>"}
```

成功返回 `access_token`, `token_type` (`bearer`), `expires_at` 和用户信息. Token 有效期为 24 小时. 受保护的接口需发送 `Authorization: Bearer <access_token>`. 登录失败返回 `401`, 未登录返回 `401`, 权限不足返回 `403`.

登录采用滑动窗口限流, 默认每 60 秒同一客户端 IP 最多 20 次、同一用户名最多 10 次. 用户名去除首尾空格并转为小写后计数, 成功、失败均计数, 切换账号仍受 IP 额度约束, 切换 IP 仍受账号额度约束. 超限在密码校验前返回 `429`, 响应体为 `{"detail": "Too many login attempts"}`, `Retry-After` 表示至少等待的秒数. 配置项为 `LOGIN_RATE_WINDOW_SECONDS`, `LOGIN_MAX_ATTEMPTS_PER_IP`, `LOGIN_MAX_ATTEMPTS_PER_USERNAME`, 均须为正整数. 计数按进程保存, 重启清空.

| 接口 | 权限 | 用途 |
| --- | --- | --- |
| `POST /api/auth/logout` | 已登录 | 撤销当前 Token |
| `GET /api/users/me` | 已登录 | 查询当前用户 |
| `POST /api/users/me/password` | 已登录 | 提交 `current_password` 和 `new_password`, 改密后所有 Token 失效 |
| `GET /api/admin/users` | 管理员 | 列出用户 |
| `POST /api/admin/users` | 管理员 | 创建用户, 请求体含 `username`, `password`, 可选 `role` (`user` / `admin`) |
| `PATCH /api/admin/users/{id}` | 管理员 | 修改 `role` 或 `is_active`; 不允许停用或降级最后一位管理员 |
| `POST /api/admin/users/{id}/password` | 管理员 | 提交 `password` 重置密码, 原有 Token 失效 |

用户名为 3-32 位字母、数字、点、下划线或连字符, 登录时不区分大小写. 停用用户会立即失去访问权限. 不直接删除用户, 以保留任务归属记录.

## 健康检查与 Worker 状态

`GET /api/health/live` 公开, 返回 `200` 和 `{"status": "ok"}`.

`GET /api/health/ready` 公开, 所有检查成功返回 `200`, 否则返回 `503`. 响应采用 `Cache-Control: no-store`, 仅返回检查结果, 错误详情保留在服务端.

```json
{
  "status": "ready",
  "checks": {"database": true, "model": true, "worker": true}
}
```

`database` 检查 PostgreSQL 连接和查询, `model` 检查本地模型配置、Tokenizer 与权重文件, `worker` 检查后台 Task 存活. 失败时 `status` 为 `not_ready`. 数据库探测连接和查询超时分别为 2 秒. S3 与实际模型推理由单独联调验证.

`GET /api/admin/worker` 仅管理员可访问:

```json
{"alive": true, "busy": false, "current_job_id": null, "queue_size": 0}
```

`queue_size` 为等待执行的任务数, 当前执行任务通过 `current_job_id` 表示. `alive` 反映协程存活, 长时间推理时仍为 `true`. Worker 完成、取消或异常退出后为 `false`.

## Speaker 管理

### 列出所有 Speaker

```text
GET /api/speakers
```

```json
[
  {
    "id": 1,
    "name": "亚托克斯",
    "description": "暗裔剑魔...",
    "icon_url": "https://s3.example.com/vox-warehouse/speaker/1/icon.png"
  }
]
```

### 获取单个 Speaker

```text
GET /api/speakers/1
```

### 上传音频并创建 Speaker

管理员调用 `POST /api/admin/speakers`, 使用 `multipart/form-data` 提交:

| 字段 | 要求 |
| --- | --- |
| `name` | 音色名称, 必填, 最多 100 字符 |
| `prompt_text` | 音频对应文本, 必填, 最多 4096 字符 |
| `description` | 描述, 可选, 最多 500 字符 |
| `audio` | WAV, MP3, FLAC 或 OGG 文件, 非空, 最大 20 MB, 最长 30 秒 |

音频需为单声道或双声道, 采样率 8-192 kHz. 服务校验实际文件内容, 转为单声道 PCM WAV, 上传参考音频及 `vox-data.json` 后写入索引. 成功返回 `201` 和 Speaker 信息, 新音色立即对所有用户可见, 后续 S3 导入仍会保留. 无效音频返回 `400`, 超出文件大小返回 `413`, 字段校验失败返回 `422`, 保存失败返回 `503`. Web 入口位于系统管理的 "添加音频".

### 删除 Speaker

```text
DELETE /api/admin/speakers/{speaker_id}
```

仅管理员可访问. 服务与上传和导入共用写入锁, 先删除 `{S3_SPEAKER_PREFIX}{speaker_id}/vox-data.json`, 再删除 PostgreSQL 索引, 最后删除该前缀下的其余对象, 如参考音频和头像. 删除元数据后, 后续导入不会恢复该 Speaker.

成功返回 `204`, Speaker 不在索引中返回 `404`. 元数据或索引删除失败返回 `503`, 音色仍可使用, 可重试删除. 剩余对象清理失败只记录日志, 存储桶可能留下无引用的对象.

历史任务保留, 列表和详情中的 `speaker_name` 与 `speaker_icon_url` 为 `null`. 使用该 Speaker 的排队任务会失败. Web 入口位于系统管理的 "音色列表".

### 导入 Speaker 元数据

从 S3 的 `S3_SPEAKER_PREFIX` 下导入 `{id}/vox-data.json`, 更新和删除 PostgreSQL 中的 Speaker 索引. 不上传本地文件, 也不全量下载音频或头像. 发布资源时先上传音频和头像, 再上传 JSON, 最后触发导入:

```text
POST /api/admin/speakers/sync         → {"status": "submitted"}
GET  /api/admin/speakers/sync/status  → {"running": false, "last_result": {...}}
```

以上接口仅管理员可访问. `last_result` 包含 `imported`、`deleted`、`errors`, 以及兼容旧客户端的 `downloaded`、`uploaded`、`skipped` (均为 0, 已弃用). 列举或读取失败、元数据无效及空集合会在 `errors` 中报告, 数据库索引保持不变. 只有完整导入成功后才会删除 S3 中已撤下的 Speaker.

### Speaker 对象结构

```text
{S3_SPEAKER_PREFIX}
  1/
    vox-data.json
    zh.wav
    icon.png
```

`vox-data.json` 示例：

```json
{
  "id": 1,
  "name": "亚托克斯",
  "description": "暗裔剑魔亚托克斯...",
  "icon_path": "speaker/{id}/icon.png",
  "voices": {
    "prompt_text": "我是湮灭，我是破坏，我是末日。",
    "prompt_wav_path": "speaker/{id}/zh.wav",
    "reference_wav_path": "speaker/{id}/zh.wav"
  }
}
```

`icon_path`、`prompt_wav_path` 和 `reference_wav_path` 都是桶内完整对象 key. `{id}` 会替换为实际 Speaker ID, key 必须属于该 Speaker 的前缀, 不接受本地绝对路径、URL 或 `..` 路径组件. 推理时按任务下载参考音频到临时目录, 任务结束后清理.

## 模型管理

### 检查并下载模型

```text
GET /api/admin/model
```

模型管理接口仅管理员可访问.

服务默认在启动时后台下载缺失模型, 由 `MODEL_AUTO_DOWNLOAD` 控制. 本接口返回模型状态, 未就绪或上次下载失败时触发下载或重试. 已有下载时复用该下载, 已就绪时返回:

```json
{"status": "ready", "path": "model/VoxCPM2"}
```

下载进行中返回 `status=downloading` 和 `progress=downloading`, 新下载返回 `status=download_started`. 无法启动下载线程时返回 `503`. 后台下载失败通过状态查询接口报告, 本接口不等待下载完成. `MODEL_AUTO_DOWNLOAD=false` 只禁止自动下载, 管理员仍可手动触发.

### 查询下载状态

```text
GET /api/admin/model/status
```

该接口只查询状态, 不触发下载. 模型就绪时返回 `status=ready` 和 `path`. 缺失或下载未完成时返回:

```json
{
  "downloading": false,
  "progress": null,
  "path": "model/VoxCPM2",
  "error": null
}
```

下载中 `downloading=true`, `progress=downloading`. 下载失败后 `downloading=false`, `progress=failed`, `error` 包含原因. `progress` 是阶段字符串, 不是百分比. 下载中或失败后遗留的 `.zvox-downloading` 标记会阻止模型被判为就绪, 成功下载并校验必需文件后才清除. 就绪仅确认本地必需文件非空, 真实加载和推理需单独验收.

离线检查和预下载命令见 [部署文档](deployment.md).

## TTS 语音生成

### 创建生成任务

```text
POST /api/jobs
Content-Type: application/json
Authorization: Bearer <access_token>

{"speaker_id": 1, "text": "你好世界"}
```

返回: `{"job_id": "a1b2c3..."}`

- `text` 最大 4096 字符
- 任务排队执行, 同一时间只运行一个
- 每位用户最多保留 `MAX_ACTIVE_JOBS_PER_USER` 个待处理或运行中的任务, 超限返回 `429`
- 每位用户每小时最多创建 `MAX_JOBS_PER_HOUR` 个任务, 超限返回 `429`
- VoxCPM 模型懒加载, 3 分钟无新任务自动释放显存

### 查询任务列表

```text
GET /api/jobs?limit=20&before=2026-05-07T12:00:00+00:00
```

返回按时间倒序分页的任务列表:

```json
[
  {
    "id": "a1b2c3...",
    "created_at": "2026-05-07T12:00:00+00:00",
    "status": "completed",
    "text": "你好世界",
    "speaker_id": 1,
    "speaker_name": "亚托克斯",
    "speaker_icon_url": "https://...",
    "started_at": "2026-05-07T12:00:01+00:00",
    "finished_at": "2026-05-07T12:00:04+00:00",
    "duration_seconds": 3.0
  }
]
```

普通用户只看自己的任务, 管理员可查看所有任务, 包括升级前创建的无归属任务. 详情接口对无权访问的任务返回 `404`.

### 查询单个任务

```text
GET /api/jobs/{job_id}
```

```json
{
  "id": "a1b2c3...",
  "speaker_id": 1,
  "user_id": 1,
  "text": "你好世界",
  "status": "completed",
  "created_at": "2026-05-07T12:00:00+00:00",
  "created_ip": "127.0.0.1",
  "started_at": "2026-05-07T12:00:01+00:00",
  "finished_at": "2026-05-07T12:00:04+00:00",
  "duration_seconds": 3.0,
  "result_url": "https://s3.example.com/vox-warehouse/output/a1b2c3.../a1b2c3...?X-Amz-...",
  "speaker_name": "亚托克斯",
  "speaker_description": "暗裔剑魔...",
  "speaker_icon_url": "https://...",
  "error": null
}
```

任务状态流转: `pending` → `running` → `completed` / `failed`

`started_at` 和 `finished_at` 使用 UTC ISO 8601. `duration_seconds` 使用单调时钟记录本次执行耗时, 包括参考音频下载、模型加载、推理与 S3 上传, 单位秒. 成功与失败均记录, 排队任务及历史任务的计时字段为 `null`, 执行中的任务仅有 `started_at`. 重启后重新执行的任务会清空前次计时, 完成后记录本次耗时.

服务重启时会重新排队未完成任务. 为维持单任务推理约束, 当前服务应使用单个 Uvicorn Worker.

`result_url` 为 S3 预签名地址, 有效期由 `PRESIGNED_EXPIRES_IN` 控制, 默认 15 分钟.

### 生成结果存储

任务完成后在 S3 中生成:

```text
{S3_OUTPUT_PREFIX}/
  {job_id}/
    {job_id}.wav      # 生成的音频
    data.json          # 任务元数据
```

两次上传失败时任务标记为 `failed`, 并尝试删除可能已上传的对象. 若删除或最终数据库状态写入失败, 存储桶可能留下无引用对象, 需按数据库中的完成任务定期核对清理.
