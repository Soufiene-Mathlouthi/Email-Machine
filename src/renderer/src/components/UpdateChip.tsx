import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { UpdateState } from '@shared/types'
import { invoke } from '../lib/api'

export default function UpdateChip() {
  const [u, setU] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    void invoke<UpdateState>('update:state').then(setU)
    return window.api.on('update:state', setU)
  }, [])

  if (u.status === 'downloading') {
    return <div className="update-chip"><Download size={15} aria-hidden="true" /> Downloading v{u.version}… {u.percent}%</div>
  }
  if (u.status === 'ready') {
    return (
      <button className="btn primary update-chip" onClick={() => void invoke('update:install')}>
        <RefreshCw size={15} aria-hidden="true" /> Restart to update to v{u.version}
      </button>
    )
  }
  return null
}
