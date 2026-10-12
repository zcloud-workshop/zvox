# ZVox 前端

Vite + React + TypeScript 单页应用, 使用 React Router, 原生 fetch 和 audio. 样式使用普通 CSS, 依赖通过 pnpm 管理.

## 开发

从本目录执行:

```bash
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

Node 固定为 `.nvmrc` 中的 24.18.0, pnpm 为 11.9.0. 若 nvm 不可用, 先安装或修复 nvm, 不使用其他 Node 版本替代.

开发地址为 `http://127.0.0.1:5173`. 后端需单独在 `http://127.0.0.1:8000` 启动. Vite 将 `/api` 请求代理到后端, 不需开放开发用的跨域来源. 音色与账号由后端提供, 页面没有内置模拟数据或默认账号.

## 功能与约束

- `/`: 公开浏览和搜索音色, 登录后提交文本生成. 按 Unicode 码点计数, 最多 4096 字符.
- `/login`: 登录, 失败提示及安全的站内返回地址.
- `/jobs`: 普通用户的个人任务或管理员的全部任务, 每页 20 条, 游标加载更多.
- `/jobs/:id`: 任务状态, 错误原因, 音频播放和临时文件链接.
- `/account`: 查看当前用户, 修改密码后重新登录.
- `/admin/users`: 创建用户, 修改角色, 启停账号和重置密码.
- `/admin/system`: 上传参考音频并创建公共音色, 导入 Speaker, 查看导入结果, 检查并下载模型.

管理员也可从工作台的 "添加音频" 进入上传表单. 填写名称和音频对应文本, 选择 WAV, MP3, FLAC 或 OGG 文件并试听后上传. 音频最大 20 MB, 最长 30 秒. 保存成功后返回工作台即可选择新音色.

Token 仅存于当前标签页的 `sessionStorage`, 刷新时调用 `/api/users/me` 校验. 退出, 过期和受保护请求的 `401` 会清理会话. 登录信息不向音频存储服务发送.

任务详情每 2 秒轮询, 列表有活跃任务时每 5 秒刷新. 页面隐藏时暂停, 终态或不可访问时停止, 离开页面时取消请求和定时器. 网络错误使用最多 30 秒的退避间隔. 创建和管理操作均不自动重试, 网络中断时应先查询结果, 避免重复操作.

模型页面初始化只访问 `/api/admin/model/status`, 点击按钮后才调用可能触发下载的 `/api/admin/model`. 后端默认在启动时自动准备缺失模型, 页面可查看状态和重试失败的下载. 当前后端不提供真实百分比进度.

音频 URL 会过期, 可以刷新播放链接或重新获取文件链接. 文件入口在新标签页打开, 是否直接下载由浏览器和存储响应头决定. 浏览器需要直接访问后端返回的头像和音频地址.

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Vitest 使用 jsdom 与 API 替身覆盖错误归一化, 会话失效, 轮询停止与取消, 重复提交保护, 文本边界, 登录生成流程, 权限, 分页和模型页面无副作用的初始化. 测试不会连接真实 S3, 下载模型或运行推理.

## 部署

```bash
pnpm build
pnpm preview
```

`preview` 仅用于本地检查生产构建, 同样将 `/api` 代理到本机 8000 端口. 简化部署时, 构建后从仓库根目录执行 `uv run python main.py`, 后端自动托管 `frontend/dist/`, 页面和 API 共用 `http://127.0.0.1:8000`. 构建必须在后端启动前完成, 已运行的后端需重启. 运行阶段只需要 Python 服务, 无需运行 Node 或 Vite. 完整步骤见 [部署文档](../docs/deployment.md).

如需独立静态服务器, 继续参考 [nginx.conf](nginx.conf):

1. 将 `root` 改为实际构建目录, 配置实际域名与 HTTPS 入口.
2. 保留 `/api` 前缀转发至单 Worker FastAPI, 不对 API 错误执行 SPA 回退.
3. 其他前端路由回退到 `index.html`, 确保刷新任务详情或管理页面时不会返回 404.
4. 确认后端返回的 S3 地址可由用户浏览器访问, HTTPS 页面对应的音频和头像也使用 HTTPS.

当前仅实现同源部署. 未将任何后端密钥写入前端配置. Nginx 示例不包含证书配置, 需接入实际部署环境.

## 代码结构

| 目录 | 用途 |
| --- | --- |
| `src/api/` | API 类型, 请求封装, 业务接口 |
| `src/auth/` | 会话保存, 当前用户与路由权限 |
| `src/hooks/` | 有取消和退避的查询, 写入操作互斥 |
| `src/components/` | 反馈, 头像, 图标, 状态及确认弹窗 |
| `src/pages/` | 工作台, 任务, 账号与管理页面 |
| `src/styles/` | 桌面与移动端布局 |
| `src/test/` | 集成测试与测试清理 |

版本要求核对来源: [Vite 安装要求](https://vite.dev/guide/), [代理配置](https://vite.dev/config/server-options#server-proxy), [React Router 安装](https://reactrouter.com/start/declarative/installation), [Vitest 入门](https://vitest.dev/guide/).
