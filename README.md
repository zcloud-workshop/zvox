# ZVox

基于 VoxCPM2 的语音克隆与文本转语音服务. 提供 React 网页工作台和 FastAPI 接口, 使用 PostgreSQL 保存账号, 音色索引与任务记录, 使用 AWS S3 或 RustFS 保存参考音频和生成结果.

## 功能

- 语音生成: 选择音色并提交文本, 查看排队和执行状态, 播放生成的 WAV 音频.
- 音色管理: 管理员上传参考音频或通过浏览器录音创建公共音色, 也可从 S3 批量导入音色元数据.
- 任务历史: 普通用户查看自己的任务, 管理员查看全部任务, 支持分页, 错误信息和执行耗时查询.
- 账号管理: 登录, 退出和修改密码, 创建 API Key 供脚本直接调用接口, 管理员创建用户, 修改角色, 启停账号及重置密码.
- 运行管理: 自动准备模型, 下载状态查询与失败重试, 提供健康检查和后台任务 Worker 状态接口.

## 快速开始

### 1. 准备环境

| 组件 | 要求 |
| --- | --- |
| Python | 使用 uv 管理, `.python-version` 指定 3.12 |
| Node.js | 使用 nvm 管理, `frontend/.nvmrc` 指定 24.18.0 |
| pnpm | 11.9.0, 由 `frontend/package.json` 声明 |
| PostgreSQL | 已创建数据库和连接用户, 用户具有建表及更新表结构的权限 |
| 对象存储 | 已创建 AWS S3 或 RustFS 存储桶, 配置可读写, 列举及删除对象的凭证 |
| 本地空间 | 模型目录和系统临时目录可写, 模型目录在部署时持久保存 |

以下命令从仓库根目录执行. Node.js 和 pnpm 仅用于前端开发与构建, 部署已有构建产物时无需运行 Node.js.

### 2. 配置连接信息

首次配置时复制模板:

```bash
cp .env.example .env
```

编辑 `.env`, 填写 `DATABASE_URL`, `S3_BUCKET` 和所选存储提供者的配置. 默认使用 RustFS, 需要填写 `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY` 和 `RUSTFS_SECRET_KEY`. 使用 AWS S3 时设置 `S3_PROVIDER=aws`, 凭证由 boto3 默认凭证链提供.

已有 `.env` 时直接更新, 保留现有配置. 数据库密码中的 URL 特殊字符需要百分号编码, PostgreSQL 端点要求 TLS 时在连接地址附加 `sslmode=require`. 应用负责初始化表和索引, 数据库与存储桶需提前创建.

### 3. 安装后端依赖并创建管理员

```bash
uv sync --locked
uv run --no-sync python -m app.tools.create_admin admin
```

管理员命令交互式输入并确认密码, 没有默认密码. 用户名为 3-32 个英文字母, 数字, 点, 下划线或连字符, 保存时统一为小写; 密码为 8-128 个字符. 已有管理员时跳过创建步骤.

### 4. 构建前端并启动服务

```bash
cd frontend
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm build
cd ..
uv run --no-sync python main.py
```

nvm 必须在当前 Shell 可用, 缺失时先安装或修复 nvm. 后端默认监听 `0.0.0.0:8000`, 使用一个 Uvicorn Worker, 不开启自动重载.

| 入口 | 地址 |
| --- | --- |
| 网页工作台 | [http://127.0.0.1:8000](http://127.0.0.1:8000) |
| Swagger UI | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) |
| 存活检查 | [http://127.0.0.1:8000/api/health/live](http://127.0.0.1:8000/api/health/live) |
| 就绪检查 | [http://127.0.0.1:8000/api/health/ready](http://127.0.0.1:8000/api/health/ready) |

后端启动时检测 `frontend/dist/index.html` 并注册网页托管. 未构建前端时只提供 API, 构建完成后需要重启后端.

### 5. 创建音色并生成语音

1. 使用管理员账号登录, 在工作台点击 "添加音频", 或进入 "系统管理".
2. 填写音色名称和音频对应文本, 上传参考音频或录制一段语音, 试听后保存. 新音色对所有用户可见.
3. 等待系统管理页面显示模型就绪. 默认在服务启动时后台下载缺失的模型, 已有完整模型时直接复用.
4. 返回工作台选择音色, 输入最多 4096 个 Unicode 码点的文本并提交.
5. 在任务详情查看状态, 完成后播放音频或打开文件链接.

新数据库没有内置音色. 上传支持 WAV, MP3, FLAC 和 OGG, 最大 20 MB, 时长大于 0 且不超过 30 秒. 音频需为单声道或双声道, 采样率为 8-192 kHz, 服务保存为单声道 PCM WAV. 浏览器录音需要 HTTPS 或 localhost 环境, 浏览器录音支持和麦克风权限, 最长录制 30 秒.

## 开发

后端开启自动重载:

```bash
uv run --no-sync python main.py --reload
```

另开终端, 从仓库根目录启动前端开发服务:

```bash
cd frontend
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

访问 [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite 将 `/api` 代理到 `http://127.0.0.1:8000`, 需同时运行后端. 前端使用真实后端提供的音色和账号. 页面路由, 轮询, 会话和独立静态部署说明见 [前端 README](frontend/README.md).

## 配置

配置从 `.env` 或环境变量读取, 已设置的环境变量优先. 完整模板见 [.env.example](.env.example), 下表列出代码默认值. 相对路径以运行目录为基准, 后端和工具命令应从仓库根目录执行.

### 服务

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8000` | `main.py` 监听端口, 命令行 `--port` 优先 |

### 数据库与模型

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 无, 必填 | PostgreSQL 连接地址 |
| `MODEL_PATH` | `model/VoxCPM2` | 本地模型目录, 可使用绝对路径 |
| `MODEL_AUTO_DOWNLOAD` | `true` | 启动和首次推理时自动准备缺失模型 |
| `MODEL_REVISION` | `master` | ModelScope 下载使用的分支或标签, 已就绪的本地模型不会自动升级 |

### 对象存储

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `S3_PROVIDER` | `rustfs` | `rustfs` 或 `aws` |
| `S3_BUCKET` | `speaker` | 已创建的存储桶名称 |
| `S3_SPEAKER_PREFIX` | `speaker/` | 音色资源前缀 |
| `S3_OUTPUT_PREFIX` | `output/` | 生成结果前缀, 保留末尾 `/` |
| `PRESIGNED_EXPIRES_IN` | `900` | 头像和音频预签名 URL 的有效期, 单位秒 |
| `RUSTFS_ENDPOINT` | `http://localhost:9000` | RustFS S3 API 地址, 仅 RustFS 模式使用 |
| `RUSTFS_ACCESS_KEY` | `minioadmin` | RustFS Access Key, 按实际存储服务填写 |
| `RUSTFS_SECRET_KEY` | `minioadmin` | RustFS Secret Key, 按实际存储服务填写 |

AWS 模式使用 boto3 默认凭证链, 例如 `AWS_ACCESS_KEY_ID` 和 `AWS_SECRET_ACCESS_KEY`, 本地 AWS 凭证文件或 IAM Role.

### 访问与额度

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_ACTIVE_JOBS_PER_USER` | `10` | 每位用户最多保留的待处理与运行中任务总数 |
| `MAX_JOBS_PER_HOUR` | `60` | 每位用户在过去一小时内最多创建的任务数 |
| `LOGIN_RATE_WINDOW_SECONDS` | `60` | 登录限流窗口, 单位秒 |
| `LOGIN_MAX_ATTEMPTS_PER_IP` | `20` | 每个 IP 在窗口内最多尝试登录的次数 |
| `LOGIN_MAX_ATTEMPTS_PER_USERNAME` | `10` | 每个规范化用户名在窗口内最多尝试登录的次数 |
| `CORS_ORIGINS` | 空 | 允许跨域访问的前端 Origin, 多个值用逗号分隔 |

## 音色资源

管理员通过网页创建音色时, 服务上传参考音频和 `vox-data.json` 到 S3, 随后写入 PostgreSQL 索引, 保存成功后即可使用.

已有音色资源可通过管理员的 "导入 Speaker" 功能发布. 先上传音频和可选头像, 再上传引用这些对象的 `vox-data.json`, 最后触发导入. 默认对象布局如下:

```text
speaker/{speaker_id}/
├── vox-data.json
├── reference.wav
└── icon.png

output/{job_id}/
├── {job_id}.wav
└── data.json
```

导入是从 S3 到 PostgreSQL 的单向索引更新, 完整成功后会删除 S3 中已撤下的音色索引. S3 列举或读取失败, 元数据无效或没有元数据时, 保留现有索引并报告错误. 音色查询始终读取 PostgreSQL, 推理时从 S3 下载参考音频到临时目录, 任务结束后清理.

元数据中的音频和头像路径使用桶内完整对象 key, 支持 `{id}` 占位符, 必须位于对应音色的前缀内. JSON 格式和导入接口见 [API 文档](docs/api.md#speaker-对象结构).

## 账号与 API

登录返回有效期 24 小时的 Bearer Token. 受保护接口通过 `Authorization: Bearer <token>` 鉴权, 网页将 Token 保存在当前标签页的 `sessionStorage`. 修改或重置密码, 停用账号及变更角色会撤销该用户已有会话和 API Key. 系统不允许停用或降级最后一位有效管理员.

脚本和其他服务可使用 API Key 代替登录 Token. 在 "账号设置" 中创建后, 同样通过 `Authorization: Bearer <API Key>` 调用接口. 完整 Key 只在创建时显示一次, 可设置有效期, 拥有所属账号的权限, 但不能退出登录, 修改密码或管理 API Key.

| 能力 | 接口 | 权限 |
| --- | --- | --- |
| 登录 | `POST /api/auth/login` | 公开 |
| 健康检查 | `GET /api/health/live`, `GET /api/health/ready` | 公开 |
| 当前账号 | `GET /api/users/me` | 登录用户 |
| 修改密码与退出登录 | `POST /api/users/me/password`, `POST /api/auth/logout` | 登录会话 |
| API Key 管理 | `GET`, `POST /api/users/me/api-keys`, `DELETE /api/users/me/api-keys/{id}` | 登录会话 |
| 浏览音色 | `GET /api/speakers`, `GET /api/speakers/{speaker_id}` | 登录用户 |
| 创建和查询任务 | `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/{job_id}` | 登录用户 |
| 用户管理 | `/api/admin/users` 及用户修改, 密码重置接口 | 管理员 |
| 创建和导入音色 | `POST /api/admin/speakers`, `POST /api/admin/speakers/sync` | 管理员 |
| 查看导入结果 | `GET /api/admin/speakers/sync/status` | 管理员 |
| 模型状态与下载 | `GET /api/admin/model/status`, `GET /api/admin/model` | 管理员 |
| Worker 状态 | `GET /api/admin/worker` | 管理员 |

"登录用户" 接受登录 Token 或 API Key, "登录会话" 仅接受登录 Token, "管理员" 接受管理员的登录 Token 或 API Key.

普通用户只能查看自己的任务, 管理员可查看全部任务及旧数据中的无归属任务. 任务状态为 `pending`, `running`, `completed` 或 `failed`. 查询已完成任务会生成临时 `result_url`, 链接过期后重新查询即可获取新链接.

登录成功和失败均计入 IP 与用户名限流, 超限返回 `429` 和 `Retry-After`. 任务创建超出额度也返回 `429`. 请求字段, 响应结构, 分页和错误码见 [API 文档](docs/api.md).

## 模型与运行机制

模型从 ModelScope 的 `OpenBMB/VoxCPM2` 下载. 服务默认在启动时后台准备缺失文件, 首次推理时懒加载模型, 空闲至少 180 秒后由定时检查卸载. 已完整下载的本地模型直接复用.

提前下载模型:

```bash
uv run --no-sync python -m app.tools.download_model
```

仅检查本地文件, 就绪时退出码为 0, 未就绪时为 1:

```bash
uv run --no-sync python -m app.tools.download_model --check
```

离线加载模型时, 预先准备完整模型目录和 Python 依赖, 设置 `MODEL_AUTO_DOWNLOAD=false`. 显式下载命令和管理员手动下载仍可使用. 管理员的 `GET /api/admin/model/status` 只读, `GET /api/admin/model` 会在模型缺失或下载失败时触发下载或重试.

任务先写入 PostgreSQL, 再进入当前进程的 `asyncio.Queue`, 由一个后台 Worker 顺序执行. 启动时将中断的 `running` 任务恢复为 `pending`, 并重新排队已有待处理任务. `started_at` 和 `finished_at` 使用 UTC ISO 8601, `duration_seconds` 包含参考音频下载, 模型加载, 推理和结果上传, 不包含排队时间.

## 部署与健康检查

部署使用一个服务实例和一个 Uvicorn Worker. 队列, 模型状态和登录限流保存在进程内, 多 Worker 或多实例需要额外的共享队列与推理协调机制.

修改监听地址和端口. 端口也可通过 `.env` 或环境变量中的 `PORT` 设置, 命令行 `--port` 优先:

```bash
uv run --no-sync python main.py --host 127.0.0.1 --port 8000
```

前端构建完成后由 FastAPI 提供页面和 API, 支持 SPA 页面刷新回退. 也可使用 [Nginx 示例](frontend/nginx.conf) 独立托管静态文件并代理 `/api`. 浏览器需要直接访问 S3 头像和音频地址, HTTPS 页面应使用 HTTPS 存储地址. 反向代理部署需在 Uvicorn 中配置可信代理, 登录限流使用 `request.client.host` 识别客户端.

| 检查 | 判断条件 |
| --- | --- |
| `/api/health/live` | HTTP 存活, 返回 `200` |
| `/api/health/ready` | PostgreSQL 查询成功, 模型文件完整, 后台 Worker 存活时返回 `200`, 否则返回 `503` |
| `/api/admin/worker` | 管理员查看 `alive`, `busy`, `current_job_id` 和 `queue_size` |

就绪检查不验证 S3 可用性或真实模型加载与推理. 目标硬件, 存储连接和实际音频生成需要在部署环境验证. 模型版本切换, 离线部署和完整运行说明见 [部署文档](docs/deployment.md).

## 验证

后端回归测试从仓库根目录执行. 数据库测试需显式设置 `TEST_DATABASE_URL`, 连接用户需具有创建和删除 Schema 的权限:

```bash
export TEST_DATABASE_URL='postgresql://zvox_test:CHANGE_ME@localhost:5432/zvox_test'
uv run --no-sync python -m unittest discover -s tests -v
```

数据库用例使用独立随机 Schema, 测试结束后删除, 不清空业务表. 未设置 `TEST_DATABASE_URL` 时数据库集成测试会跳过. 模型与 S3 相关用例使用替身, 不等于真实下载, 对象存储联调或语音推理验证. 后端未配置 linter.

前端验证从仓库根目录执行:

```bash
cd frontend
nvm use
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `main.py` | 启动参数与 Uvicorn 入口 |
| `app/main.py` | 应用生命周期, 后台任务与路由注册 |
| `app/api/` | HTTP 参数, 权限依赖和响应处理 |
| `app/services/` | 用户, 音色, 模型及任务业务逻辑 |
| `app/db/database.py` | psycopg PostgreSQL 表初始化与数据库操作 |
| `app/core/` | 环境配置和 S3 客户端 |
| `app/models/` | Pydantic 请求与响应模型 |
| `app/tools/` | 创建管理员, 准备模型和生成资源 URL 等工具 |
| `frontend/` | Vite + React + TypeScript 网页应用 |
| `tests/` | 后端回归与集成测试 |
| `docs/` | API, 部署及设计文档 |

## 相关文档

- [API 文档](docs/api.md): 接口字段, 权限, 返回值和 Speaker 元数据格式.
- [部署文档](docs/deployment.md): 模型准备, 离线部署和运行方式.
- [前端 README](frontend/README.md): 页面功能, 开发命令和静态部署.
- [S3 资源说明](docs/s3-only-assessment.md): 音色资源存储与 PostgreSQL 索引.
- [前端实施计划](docs/frontend-plan.md): 实施范围与阶段验收记录.
