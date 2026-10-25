import { readSession, saveSession } from '../auth/session'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const messages: Record<number, string> = {
  400: '请求未能完成, 请检查输入.',
  401: '登录已失效, 请重新登录.',
  403: '你没有执行此操作的权限.',
  404: '内容不存在或无权访问.',
  409: '当前操作存在冲突.',
  413: '音频文件不能超过 20 MB.',
  422: '请检查表单内容.',
  429: '任务数量已达限制, 请稍后重试.',
}
const translations: Record<string, string> = {
  'Invalid username or password': '用户名或密码不正确.',
  'Current password is incorrect': '当前密码不正确.',
  'Username already exists': '用户名已存在.',
  'Cannot disable or demote the last active admin':
    '不能停用或降级最后一位管理员.',
  'API key name is required': '请输入 Key 名称.',
  'API key limit reached': 'API Key 数量已达上限, 请先撤销不再使用的 Key.',
  'API key not found': 'API Key 不存在或已被撤销.',
}
const fields: Record<string, string> = {
  username: '用户名',
  password: '密码',
  current_password: '当前密码',
  new_password: '新密码',
  text: '文本',
  speaker_id: '音色',
  role: '角色',
  name: '音色名称',
  description: '音色描述',
  prompt_text: '音频对应文本',
  audio: '参考音频',
}

function errorMessage(status: number, body: unknown) {
  if (
    status === 429 &&
    body &&
    typeof body === 'object' &&
    'detail' in body &&
    body.detail === 'Too many login attempts'
  )
    return '登录尝试过于频繁, 请稍后重试.'
  if (status === 429 || status >= 500)
    return messages[status] ?? '服务暂时不可用, 请稍后重试.'
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = body.detail
    if (typeof detail === 'string')
      return (
        translations[detail] ?? `${messages[status] ?? '请求失败.'} ${detail}`
      )
    if (Array.isArray(detail)) {
      return detail
        .map((item: { loc?: (string | number)[]; msg?: string }) => {
          const field = String(item.loc?.at(-1) ?? '')
          return `${fields[field] ?? field}: ${item.msg ?? '输入无效'}`
        })
        .join('; ')
    }
  }
  return messages[status] ?? '请求失败, 请稍后重试.'
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  auth?: boolean
}

export async function request<T>(
  path: string,
  { body, auth = true, ...options }: RequestOptions = {},
): Promise<T> {
  const token = auth ? readSession()?.access_token : undefined
  if (auth && !token) {
    saveSession(null)
    throw new ApiError(401, messages[401])
  }
  const headers = new Headers(options.headers)
  const isForm = body instanceof FormData
  if (isForm) headers.delete('Content-Type')
  else if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError(
      0,
      '网络连接失败. 写入操作的结果可能尚未确认, 请先刷新列表再重试.',
    )
  }
  if (response.status === 401 && auth && readSession()?.access_token === token)
    saveSession(null)
  if (response.status === 204) return undefined as T
  let data: unknown
  try {
    data = await response.json()
  } catch {
    if (!response.ok)
      throw new ApiError(response.status, errorMessage(response.status, null))
    throw new ApiError(502, '服务返回了无法识别的数据, 请检查 API 连接.')
  }
  if (!response.ok)
    throw new ApiError(response.status, errorMessage(response.status, data))
  return data as T
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败, 请重试.'
}
