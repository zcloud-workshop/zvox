# ZVox 模型拉取与部署

日期: 2026-10-07.

状态: 已实现自动准备模型, 下载复用与失败重试, 命令行预下载, 生产启动模式及前后端同端口托管. 验证范围见第 7 节.

## 1. 部署方式

推荐将前端构建为静态文件, 由一个 FastAPI 进程同时提供页面和 API. 服务启动时初始化 PostgreSQL 表, 后台准备缺失模型并启动一个顺序处理任务的 Worker. 账号创建和 Speaker 发布继续使用现有命令与管理员功能.

| 组件 | 准备要求 |
| --- | --- |
| Python | `.python-version` 指定 3.12, 通过 uv 安装锁文件中的依赖 |
| 前端构建 | Node 由 `frontend/.nvmrc` 固定, 使用 nvm 和 pnpm; 构建完成后运行服务无需 Node |
| PostgreSQL | 预先创建可连接的数据库和用户, 配置 `DATABASE_URL`; 应用初始化表, 不创建数据库或连接账号 |
| S3 | 已有 AWS S3 或 RustFS 存储桶, 配置访问凭证与对象前缀 |
| 模型与临时空间 | `MODEL_PATH` 持久保存模型, 推理时使用可写临时目录 |

仍使用一个 Uvicorn Worker 和一个服务实例. 共享 PostgreSQL 不会把内存队列变成共享队列, 也不会协调多个实例的任务恢复或推理. GPU, MPS 或 CPU 的实际加载与吞吐需要在目标主机验收.

## 2. 首次部署

以下命令从仓库根目录执行. 新环境复制配置文件后, 填写 PostgreSQL 和 S3 信息. 已有 `.env` 时直接更新, 保留现有连接配置.

```bash
cp .env.example .env
```

必须填写 `DATABASE_URL`, `S3_BUCKET` 及所选 S3 提供者的连接信息. RustFS 使用 `RUSTFS_ENDPOINT`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`; AWS 使用 boto3 默认凭证链. `MODEL_PATH` 默认相对于运行目录, 所有启动和模型准备命令均从仓库根目录执行, 或配置绝对路径.

安装依赖, 创建首个管理员:

```bash
uv sync --locked
uv run --no-sync python -m app.tools.create_admin admin
```

管理员命令交互式读取密码, 没有默认密码. 已有管理员时跳过创建步骤. 新数据库没有内置 Speaker, 登录后上传参考音频创建音色, 或导入已经发布到 S3 的 Speaker 元数据.

构建前端并启动服务:

```bash
cd frontend
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm build
cd ..
uv run --no-sync python main.py
```

nvm 需在当前 Shell 可用; 缺失时先安装或修复, 不使用其他 Node 来源替代. 构建机可以提前产出 `frontend/dist/`, 部署机随代码接收该目录后只执行 Python 安装与启动步骤.

访问 `http://127.0.0.1:8000` 打开页面, `http://127.0.0.1:8000/docs` 查看 API 文档. 启动时有 `frontend/dist/index.html` 才注册前端托管; 没有构建时继续提供 API, 之后构建需要重启后端. `/jobs/{id}` 等页面支持刷新回退, 缺失静态资源返回 404. API 路由和错误不会回退成 HTML, 原有 404 和 405 行为保留.

`main.py` 默认监听 `0.0.0.0:8000`, 不开启 reload. 端口也可通过 `.env` 或环境变量中的 `PORT` 设置, 命令行 `--port` 优先于 `PORT`, 已设置的环境变量优先于 `.env`. 直接使用 `uvicorn` 命令启动时不读取 `PORT`. 更改监听地址和端口:

```bash
uv run --no-sync python main.py --host 127.0.0.1 --port 8000
```

公网 HTTPS 入口可接入现有反向代理, 页面和 API 共同转发到后端. 如需独立托管静态文件, 保留 [前端 Nginx 配置](../frontend/nginx.conf). 浏览器必须能访问 API 返回的 S3 头像与预签名音频地址.

## 3. 模型拉取逻辑

| 场景 | 实际行为 |
| --- | --- |
| 启动时本地模型完整 | 直接复用, 不请求模型仓库 |
| 启动时模型缺失, 自动下载开启 | 后台下载, HTTP 启动不等待整个下载完成 |
| 首次推理遇到下载进行中 | 在线程内等待已有下载完成, 不读取下载中的模型 |
| 首次推理模型缺失, 自动下载开启 | 按需准备模型后再从本地加载 |
| 自动下载关闭且模型缺失 | 任务明确失败, 不由 VoxCPM 隐式联网下载 |
| 多个进程内调用同时准备模型 | 共用下载状态与 Condition, 等待同一个下载 |
| 下载失败 | 保存错误, 清除运行中状态, 唤醒等待者; 当前等待者收到失败, 后续调用或管理员操作可重新尝试 |

启动, 命令行和推理共用 [模型服务](../app/services/model.py). 只拉取当前加载器需要的配置, Tokenizer 和权重候选文件, 不拉取 README 或示例资源. ModelScope 的文件缓存与文件锁继续复用, 本项目不另写下载器, 不承诺所有失败都能按字节续传. SDK 文件锁用于下载协调, 不代表应用支持多 Worker 推理.

下载开始时在模型目录创建 `.zvox-downloading`. 只有 SDK 返回成功, 必需文件非空并且权重候选齐全后才删除标记. 下载失败或进程退出留下的标记会阻止下次启动误用该目录, 重试时继续复用 SDK 下载缓存. 不手工删除标记来绕过失败校验.

目前文件检查要求 `config.json`, `tokenizer.json`, `tokenizer_config.json`, 至少一个 `audiovae.safetensors` 或 `audiovae.pth`, 至少一个 `model.safetensors` 或 `pytorch_model.bin`. 已有人工准备的模型通过同样检查即可使用. 该检查不解析完整权重, 不证明文件内容正确或目标硬件可运行; 实际加载失败仍通过任务错误报告.

VoxCPM 继续在第一个任务时懒加载, 空闲 180 秒后卸载. 加载显式使用本地目录和 `local_files_only=True`, 并保留 `load_denoiser=False`. 文件就绪与模型已加载是不同状态.

## 4. 配置与版本

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `MODEL_PATH` | `model/VoxCPM2` | 模型本地目录, 可配置绝对路径 |
| `MODEL_AUTO_DOWNLOAD` | `true` | 启动和首次加载时是否自动准备缺失模型 |
| `MODEL_REVISION` | `master` | 传给 ModelScope 的分支或标签, 模型仓库仍为 `OpenBMB/VoxCPM2` |

`MODEL_AUTO_DOWNLOAD` 接受 `true`, `1`, `yes` 开启, 其余值关闭, 示例使用 `true` 或 `false`. 关闭自动下载后, 显式命令行预下载和管理员手动下载仍可用.

依赖版本由 `uv.lock` 和 `frontend/pnpm-lock.yaml` 固定. 模型默认分支 `master` 会变化, 不能视为固定快照. 需要固定模型版本时使用模型仓库实际存在的发布标签. 本次核对的 ModelScope 1.36.3 文档声明 `revision` 支持分支和标签, 不将任意 commit SHA 作为已验证能力.

就绪的本地模型不会因为修改 `MODEL_REVISION` 自动替换. 升级时停止服务, 保留旧模型, 为新版本配置新的 `MODEL_PATH`, 预下载并完成真实加载验证后重启. 回滚时恢复旧目录和配置. 这样不会把新旧版本文件混在同一目录内.

## 5. 预下载, 离线与重试

预下载不要求创建管理员或连接数据库, 下载完成前命令保持运行; 成功退出码为 0, 失败为 1:

```bash
uv run --no-sync python -m app.tools.download_model
```

只检查本地文件, 不请求模型仓库. 就绪退出码为 0, 未就绪或检查失败为 1:

```bash
uv run --no-sync python -m app.tools.download_model --check
```

离线部署先在可联网环境完成依赖安装和模型预下载, 将完整模型目录与前端构建交付到目标主机. 目标主机准备好 Python 依赖, 配置 `MODEL_AUTO_DOWNLOAD=false` 和对应 `MODEL_PATH`, 执行本地检查后启动. 离线模型加载仍需可访问业务使用的 PostgreSQL 和 S3.

在线运行时, 管理员可在系统页面查询状态和重试, 或调用现有 `GET /api/admin/model`. `GET /api/admin/model/status` 始终只读. 下载进度仍是阶段字符串, 不提供估算百分比. 异步下载失败通过 `error` 报告, 无法启动下载线程返回 503. 模型未就绪时不要把 HTTP 存活当作语音服务已可用.

## 6. 开发与变更范围

后端开发使用显式 reload:

```bash
uv run --no-sync python main.py --reload
```

前端开发在另一个终端执行 `nvm use` 和 `pnpm dev`, 使用现有 Vite `/api` 代理. 生产构建不会启动 Vite 服务.

| 文件 | 本次修改 |
| --- | --- |
| `app/services/model.py` | 统一模型准备, 过滤下载文件, 并发等待, 下载标记与错误状态 |
| `app/services/tts.py` | 推理前准备模型, 显式只从本地加载 |
| `app/core/config.py`, `.env.example` | 自动下载开关与模型 revision |
| `app/api/admin.py` | 下载和状态委托模型服务, 保留既有返回结构 |
| `app/tools/download_model.py` | 命令行预下载与只读检查 |
| `app/api/frontend.py`, `app/main.py` | 自动准备模型, 前端静态托管与 SPA 回退, 保留 API 路由优先级 |
| `main.py` | 默认生产启动, 显式 reload 和监听参数 |
| `tests/test_deployment.py` | 模型准备与部署行为的隔离验证 |

复用已有 ModelScope, VoxCPM, FastAPI 和 Starlette, 没有新增运行依赖或改变业务数据库结构. 工作区原有 PostgreSQL, Speaker, 认证和运行状态相关改动保持现有逻辑, 本次不将这些改动计入模型与部署优化.

## 7. 验证记录

新增的 12 项模型准备与部署隔离测试全部通过, 覆盖本地模型复用, 下载参数, 并发只下载一次, 下载中禁止加载, 失败与不完整下载, 中断标记保留, 重试, 离线禁止联网, 线程启动失败, 状态只读, CLI 检查, 推理本地加载, 管理接口失败响应, 启动开关及 SPA/API 路由兼容. 当前测试集合共发现 58 项, 33 项通过, 25 项 PostgreSQL 集成测试跳过.

测试使用临时目录, 模型仓库和 VoxCPM 加载替身, 不下载真实权重, 不进行真实推理. PostgreSQL 集成测试仅在显式配置 `TEST_DATABASE_URL` 时执行; 本次环境未配置该变量, 数据库集成测试跳过. S3 与目标硬件推理仍需真实联调.

可复现验证命令:

```bash
uv run --no-sync python -m unittest discover -s tests -p 'test_deployment.py' -v
uv run --no-sync python -m unittest discover -s tests -v
```

前端通过 nvm 使用 `.nvmrc` 指定的 Node 24.18.0, `pnpm build` 成功. 使用实际 FastAPI 应用和真实构建产物完成 TestClient 检查: `/`, `/jobs/example`, `/admin/system` 返回页面, 两个构建资源返回 200, 未知 API 返回 404, 错误 API 方法返回 405, 缺失资源返回 404, `/docs` 和存活接口正常. 该检查执行了应用 lifespan, 当前配置的 PostgreSQL 初始化和 Worker 启动成功, 不等于数据库集成回归或真实语音推理验收.

本地 `download_model --check` 返回就绪, 仅确认当前模型目录通过文件检查. `uv lock --check --offline` 和 `git diff --check` 通过, 文档本地链接及代码围栏检查通过. 公网入口, S3, 完整权重加载和实际音频生成仍需在目标环境验收; 本次未执行真实模型下载, 镜像构建或公网部署.

参数依据已对照本地安装的 ModelScope 1.36.3 与 VoxCPM 2.0.2 源码, 并查阅 [ModelScope 下载说明](https://www.modelscope.cn/docs/models/download), [官方 SDK 下载实现](https://github.com/modelscope/modelscope/blob/v1.36.3/modelscope/hub/snapshot_download.py), [VoxCPM 官方模型目录](https://huggingface.co/openbmb/VoxCPM2/tree/main) 和 [uv 项目运行说明](https://docs.astral.sh/uv/guides/projects/). 当前会话未提供 augment-context-engine, LSP 或 ZRead, 本地调用关系通过文件阅读和 `rg` 引用搜索核对.
