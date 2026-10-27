import { Link } from 'react-router'
import { PageHeading } from '../components/Feedback'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type AuthKind = 'none' | 'token' | 'session' | 'admin'

type Param = {
  name: string
  place: 'body' | 'query' | 'path' | 'form'
  optional?: boolean
  description: string
}

type Endpoint = {
  method: Method
  path: string
  description: string
  auth: AuthKind
  params?: Param[]
  success: string
  errors?: string[]
  requestExample?: string
  responseExample?: string
}

type Group = {
  title: string
  caption: string
  note?: string
  endpoints: Endpoint[]
}

const authLabels: Record<AuthKind, string> = {
  none: '无需认证',
  token: 'Bearer 令牌',
  session: '仅登录会话',
  admin: '仅管理员',
}

const quickStart = `# 1. 登录换取令牌 (24 小时有效, 也可改用账号设置里创建的 API Key)
curl -s -X POST https://your-zvox-host/api/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"username": "your-name", "password": "your-password"}'

# 2. 创建语音生成任务
curl -s -X POST https://your-zvox-host/api/jobs \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"speaker_id": 1, "text": "你好, 欢迎使用 ZVox."}'

# 3. 轮询任务状态, status 变为 completed 后用 result_url 下载音频
curl -s https://your-zvox-host/api/jobs/<job_id> \\
  -H "Authorization: Bearer $TOKEN"`

const groups: Group[] = [
  {
    title: '认证',
    caption: '登录会话与令牌',
    endpoints: [
      {
        method: 'POST',
        path: '/api/auth/login',
        description: '使用用户名和密码登录, 返回 24 小时有效的 Bearer 令牌.',
        auth: 'none',
        params: [
          { name: 'username', place: 'body', description: '用户名, 最长 32 字符.' },
          { name: 'password', place: 'body', description: '密码, 最长 128 字符.' },
        ],
        success: '200 · 返回 access_token 与用户信息.',
        errors: [
          '401 用户名或密码错误.',
          '429 尝试过于频繁, 响应头 Retry-After 给出需等待的秒数.',
        ],
        responseExample: `{
  "access_token": "…",
  "token_type": "bearer",
  "expires_at": "2026-10-28T09:00:00Z",
  "user": {
    "id": 1,
    "username": "demo",
    "role": "user",
    "is_active": true,
    "created_at": "2026-10-01T08:00:00Z"
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/auth/logout',
        description: '撤销当前登录会话. 仅接受登录令牌, API Key 无法调用.',
        auth: 'session',
        success: '204 · 无响应体.',
      },
    ],
  },
  {
    title: '账号',
    caption: '当前用户信息与密码',
    endpoints: [
      {
        method: 'GET',
        path: '/api/users/me',
        description: '查询令牌对应的用户信息.',
        auth: 'token',
        success: '200 · 返回 id, username, role, is_active, created_at.',
      },
      {
        method: 'POST',
        path: '/api/users/me/password',
        description:
          '修改密码. 成功后该用户的所有登录会话与 API Key 立即失效, 需要重新登录.',
        auth: 'session',
        params: [
          { name: 'current_password', place: 'body', description: '当前密码.' },
          {
            name: 'new_password',
            place: 'body',
            description: '新密码, 8-128 个字符.',
          },
        ],
        success: '204 · 无响应体.',
        errors: ['400 当前密码不正确.'],
      },
    ],
  },
  {
    title: 'API Key',
    caption: '为脚本或其他服务签发长期凭证',
    endpoints: [
      {
        method: 'GET',
        path: '/api/users/me/api-keys',
        description: '列出当前用户已创建的 API Key (不含明文).',
        auth: 'session',
        success:
          '200 · 返回 id, name, prefix, created_at, expires_at, last_used_at 列表.',
      },
      {
        method: 'POST',
        path: '/api/users/me/api-keys',
        description:
          '创建 API Key. 响应中的 key 明文仅出现这一次, 请立即保存. Key 的权限与账号一致, 但不能管理 API Key 或修改密码.',
        auth: 'session',
        params: [
          { name: 'name', place: 'body', description: 'Key 名称, 1-64 个字符.' },
          {
            name: 'expires_in_days',
            place: 'body',
            optional: true,
            description: '有效期天数, 1-3650. 缺省表示永不过期.',
          },
        ],
        success: '201 · 返回 Key 详情与明文 key.',
        errors: ['409 已超出 API Key 数量上限.'],
        responseExample: `{
  "id": 7,
  "name": "批量生成脚本",
  "prefix": "zvox_ab12",
  "key": "zvox_…完整 Key 仅此一次可见…",
  "created_at": "2026-10-27T09:00:00Z",
  "expires_at": "2027-10-27T09:00:00Z",
  "last_used_at": null
}`,
      },
      {
        method: 'DELETE',
        path: '/api/users/me/api-keys/{key_id}',
        description: '撤销 API Key, 使用此 Key 的请求立即失败, 无法恢复.',
        auth: 'session',
        success: '204 · 无响应体.',
        errors: ['404 Key 不存在.'],
      },
    ],
  },
  {
    title: '音色',
    caption: '浏览, 创建与管理音色',
    note: '音色对象包含 id, name, description, icon_url, owner_id (null 表示系统音色), owner_username, status, review_comment 和 audio_url (参考音频试听直链, 预签名有时效). status 取值: private 私有 / pending 待审核 / approved 已公开 / rejected 已驳回.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/speakers',
        description: '列出当前用户可用的音色: 系统音色, 自己创建的与广场公开音色.',
        auth: 'token',
        success: '200 · 返回音色对象列表.',
      },
      {
        method: 'GET',
        path: '/api/speakers/plaza',
        description: '浏览音色广场: 系统音色与审核通过的公开音色.',
        auth: 'token',
        success: '200 · 返回音色对象列表.',
      },
      {
        method: 'GET',
        path: '/api/speakers/mine',
        description: '列出当前用户创建的音色及审核状态.',
        auth: 'token',
        success: '200 · 返回音色对象列表.',
      },
      {
        method: 'GET',
        path: '/api/speakers/{speaker_id}',
        description: '查询单个音色的详细信息.',
        auth: 'token',
        success: '200 · 返回音色对象.',
        errors: ['404 音色不存在或无权查看.'],
      },
      {
        method: 'POST',
        path: '/api/speakers',
        description:
          '上传参考音频创建音色, 请求使用 multipart/form-data. 每个用户最多创建 20 个音色.',
        auth: 'token',
        params: [
          { name: 'name', place: 'form', description: '音色名称, 1-100 个字符.' },
          {
            name: 'prompt_text',
            place: 'form',
            description: '参考音频读出的文字内容, 1-4096 个字符.',
          },
          {
            name: 'description',
            place: 'form',
            optional: true,
            description: '音色描述, 最长 500 字符.',
          },
          {
            name: 'publish',
            place: 'form',
            optional: true,
            description: '为 true 时创建后直接提交广场审核, 缺省保持私有.',
          },
          {
            name: 'audio',
            place: 'form',
            description: '参考音频文件, 最大 20MB.',
          },
        ],
        success: '201 · 返回新创建的音色对象.',
        errors: [
          '409 已超出音色数量上限.',
          '413 参考音频超过 20MB.',
          '400 参数不合法.',
        ],
        requestExample: `curl -X POST https://your-zvox-host/api/speakers \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "name=我的音色" \\
  -F "prompt_text=参考音频读出的文字内容" \\
  -F "description=温柔的旁白声" \\
  -F "publish=false" \\
  -F "audio=@reference.wav"`,
      },
      {
        method: 'POST',
        path: '/api/speakers/{speaker_id}/submit',
        description: '把自己的音色 (private 或 rejected) 提交到广场审核.',
        auth: 'token',
        success: '204 · 无响应体.',
        errors: ['409 当前状态不允许此操作.'],
      },
      {
        method: 'POST',
        path: '/api/speakers/{speaker_id}/withdraw',
        description: '撤回审核中的申请, 或把已公开的音色从广场下架.',
        auth: 'token',
        success: '204 · 无响应体.',
        errors: ['409 当前状态不允许此操作.'],
      },
    ],
  },
  {
    title: '语音任务',
    caption: '提交文案, 轮询结果',
    note: '任务由后台队列顺序处理, 状态依次为 pending / running / completed / failed. 配额: 每用户同时进行 10 个任务, 每小时最多提交 60 个.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/jobs',
        description: '创建语音生成任务, 校验音色可用后入队.',
        auth: 'token',
        params: [
          { name: 'speaker_id', place: 'body', description: '音色 ID.' },
          { name: 'text', place: 'body', description: '要合成的文本, 最长 4096 字符.' },
        ],
        success: '200 · 返回 {"job_id": "…"}.',
        errors: [
          '404 音色不存在.',
          '403 无权使用该音色.',
          '429 已超出任务配额.',
        ],
      },
      {
        method: 'GET',
        path: '/api/jobs',
        description:
          '按时间倒序分页查询任务. 管理员可见全部任务, 普通用户仅可见自己的.',
        auth: 'token',
        params: [
          {
            name: 'limit',
            place: 'query',
            optional: true,
            description: '每页数量, 1-100, 缺省 20.',
          },
          {
            name: 'before',
            place: 'query',
            optional: true,
            description: '分页游标: 传上一页最早一条的 created_at.',
          },
        ],
        success: '200 · 返回任务列表项 (含 speaker_name 等摘要字段).',
      },
      {
        method: 'GET',
        path: '/api/jobs/{job_id}',
        description:
          '查询任务详情. completed 时包含 result_url 音频下载直链 (预签名, 有时效, 每次查询重新生成).',
        auth: 'token',
        success: '200 · 返回任务详情.',
        errors: ['404 任务不存在.'],
        responseExample: `{
  "id": "9f3c21e0…",
  "speaker_id": 1,
  "text": "你好, 欢迎使用 ZVox.",
  "status": "completed",
  "created_at": "2026-10-27T09:00:00Z",
  "started_at": "2026-10-27T09:00:01Z",
  "finished_at": "2026-10-27T09:00:12Z",
  "duration_seconds": 11.3,
  "result_url": "https://…/9f3c21e0….wav?…",
  "error": null
}`,
      },
    ],
  },
  {
    title: '管理',
    caption: '仅管理员角色可调用',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/users',
        description: '列出全部用户.',
        auth: 'admin',
        success: '200 · 返回用户列表.',
      },
      {
        method: 'POST',
        path: '/api/admin/users',
        description: '创建用户.',
        auth: 'admin',
        params: [
          {
            name: 'username',
            place: 'body',
            description: '3-32 个字符, 仅限字母, 数字和 . _ -.',
          },
          { name: 'password', place: 'body', description: '密码, 8-128 个字符.' },
          {
            name: 'role',
            place: 'body',
            optional: true,
            description: 'admin 或 user, 缺省 user.',
          },
        ],
        success: '201 · 返回新用户.',
        errors: ['409 用户名已存在.'],
      },
      {
        method: 'PATCH',
        path: '/api/admin/users/{user_id}',
        description: '修改用户角色或启用状态.',
        auth: 'admin',
        params: [
          { name: 'role', place: 'body', optional: true, description: 'admin 或 user.' },
          { name: 'is_active', place: 'body', optional: true, description: '是否启用.' },
        ],
        success: '200 · 返回更新后的用户.',
        errors: ['404 用户不存在.', '409 变更会移除最后一位活跃管理员等冲突.'],
      },
      {
        method: 'POST',
        path: '/api/admin/users/{user_id}/password',
        description: '重置用户密码. 该用户的会话与 API Key 全部失效.',
        auth: 'admin',
        params: [
          { name: 'password', place: 'body', description: '新密码, 8-128 个字符.' },
        ],
        success: '204 · 无响应体.',
        errors: ['404 用户不存在.'],
      },
      {
        method: 'GET',
        path: '/api/admin/speakers/reviews',
        description: '列出待审核的广场公开申请.',
        auth: 'admin',
        success: '200 · 返回音色对象列表.',
      },
      {
        method: 'POST',
        path: '/api/admin/speakers/{speaker_id}/review',
        description: '审核公开申请: 通过后音色进入广场, 驳回可附审核意见.',
        auth: 'admin',
        params: [
          { name: 'decision', place: 'body', description: 'approve 或 reject.' },
          {
            name: 'comment',
            place: 'body',
            optional: true,
            description: '审核意见, 最长 500 字符, 驳回时展示给音色所有者.',
          },
        ],
        success: '200 · 返回审核后的音色对象.',
        errors: ['404 音色不存在.', '409 该音色不在待审核状态.'],
      },
    ],
  },
]

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  return (
    <article className="endpoint">
      <div className="endpoint-head">
        <span className={`method-badge ${endpoint.method.toLowerCase()}`}>
          {endpoint.method}
        </span>
        <code className="endpoint-path">{endpoint.path}</code>
        <span className="auth-chip">{authLabels[endpoint.auth]}</span>
      </div>
      <p className="endpoint-desc">{endpoint.description}</p>
      {endpoint.params && (
        <table className="param-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>位置</th>
              <th>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {endpoint.params.map((param) => (
              <tr key={param.name}>
                <td>
                  <code>{param.name}</code>
                </td>
                <td>{param.place}</td>
                <td>{param.optional ? '否' : '是'}</td>
                <td>{param.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="endpoint-success">{endpoint.success}</p>
      {endpoint.errors && (
        <ul className="endpoint-errors">
          {endpoint.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {endpoint.requestExample && (
        <>
          <p className="code-label">请求示例</p>
          <pre className="code-block">{endpoint.requestExample}</pre>
        </>
      )}
      {endpoint.responseExample && (
        <>
          <p className="code-label">响应示例</p>
          <pre className="code-block">{endpoint.responseExample}</pre>
        </>
      )}
    </article>
  )
}

export function ApiDocs() {
  return (
    <>
      <PageHeading
        eyebrow="REST API"
        title="API 文档"
        description="ZVox 全部接口以 JSON 交互 (创建音色使用 multipart 表单), 供脚本或其他服务直接调用."
      />
      <div className="api-docs">
        <section className="panel">
          <h2>认证</h2>
          <p className="muted">
            除登录外, 所有接口都需要通过请求头{' '}
            <code>Authorization: Bearer &lt;令牌&gt;</code> 认证. 令牌可以是登录返回的{' '}
            <code>access_token</code> (24 小时有效), 也可以是在{' '}
            <Link to="/account">账号设置</Link> 中创建的 API Key (
            <code>zvox_</code> 前缀, 长期有效). API Key 权限与账号一致,
            但不能管理 API Key 或修改密码; 修改或重置密码后, 令牌与 Key 全部失效,
            收到 401 时请重新登录获取新令牌.
          </p>
          <p className="code-label">快速开始</p>
          <pre className="code-block">{quickStart}</pre>
        </section>
        {groups.map((group) => (
          <section className="panel" key={group.title}>
            <div className="section-title">
              <h2>{group.title}</h2>
              <div>{group.caption}</div>
            </div>
            {group.note && <p className="muted small">{group.note}</p>}
            {group.endpoints.map((endpoint) => (
              <EndpointCard key={`${endpoint.method} ${endpoint.path}`} endpoint={endpoint} />
            ))}
          </section>
        ))}
      </div>
    </>
  )
}
