import { useState } from 'react'

export function Avatar({
  name,
  url,
  id = 0,
}: {
  name: string
  url?: string | null
  id?: number
}) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return (
    <span className={`avatar tone-${id % 4}`} aria-hidden="true">
      {url && failedUrl !== url ? (
        <img src={url} alt="" onError={() => setFailedUrl(url)} />
      ) : (
        Array.from(name)[0]
      )}
    </span>
  )
}
