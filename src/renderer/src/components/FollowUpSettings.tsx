import { useEffect, useState } from 'react'
import type { FollowUpConfig, FollowUpRunSummary, FollowUpStepConfig, Template } from '@shared/types'
import { errorText, invoke, useData } from '../lib/api'

export default function FollowUpSettings({ config, onSaved }: { config: FollowUpConfig; onSaved: () => void }) {
  const [templates] = useData<Template[]>('templates:list', [])
  const [draft, setDraft] = useState<FollowUpConfig>(config)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState('')

  useEffect(() => setDraft(config), [config])

  const dirty = JSON.stringify(draft) !== JSON.stringify(config)
  const hasTemplate = (id: number | null) => id !== null && templates.some((t) => t.id === id)
  const setStep = (i: 0 | 1, patch: Partial<FollowUpStepConfig>) =>
    setDraft((d) => {
      const steps = [...d.steps] as FollowUpConfig['steps']
      steps[i] = { ...steps[i], ...patch }
      return { ...d, steps }
    })

  const save = async () => {
    await invoke('settings:set', { followUps: draft })
    onSaved()
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const s = await invoke<FollowUpRunSummary>('followups:run')
      const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
      setResult(`${n(s.repliesFound, 'reply', 'replies')} found · ${n(s.bounces, 'bounce', 'bounces')} · ` +
        `${n(s.draftsCreated, 'follow-up draft', 'follow-up drafts')} created`)
    } catch (e) {
      setResult(errorText(e))
    } finally {
      setRunning(false)
    }
  }

  const templateSelect = (value: number | null, onChange: (id: number | null) => void, emptyLabel: string) => (
    <select value={hasTemplate(value) ? String(value) : ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  )

  return (
    <section className="panel">
      <label className="check strong">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        Create follow-up drafts automatically
      </label>
      <p className="hint">
        Follow-ups land in the Outbox as drafts for review, threaded as replies. They stop when a reply is detected
        (Gmail accounts) or when you use "Mark replied". Only emails sent after you turn this on are followed up.
        Follow-ups use the template's body; the subject is always "Re: &lt;original subject&gt;" so the thread stays together.
      </p>
      <div className="grid2">
        <label className="field"><span>Follow-up 1 template</span>
          {templateSelect(draft.steps[0].templateId, (id) => setStep(0, { templateId: id }), 'Choose a template…')}</label>
        <label className="field"><span>Send after (days)</span>
          <input type="number" min={1} max={365} value={draft.steps[0].delayDays}
            onChange={(e) => setStep(0, { delayDays: Number(e.target.value) })} /></label>
        <label className="field"><span>Follow-up 2 template</span>
          {templateSelect(draft.steps[1].templateId, (id) => setStep(1, { templateId: id }), 'None (only one follow-up)')}</label>
        <label className="field"><span>Days after follow-up 1</span>
          <input type="number" min={1} max={365} value={draft.steps[1].delayDays} disabled={draft.steps[1].templateId === null}
            onChange={(e) => setStep(1, { delayDays: Number(e.target.value) })} /></label>
      </div>
      {draft.enabled && !hasTemplate(draft.steps[0].templateId) && (
        <div className="status-line bad">Pick a template for follow-up 1, or no follow-ups will be created.</div>
      )}
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={() => void save()}>Save follow-ups</button>
        <button className="btn" disabled={running} onClick={() => void runNow()}>{running ? 'Checking…' : 'Check now'}</button>
        {result && <span className="muted small">{result}</span>}
      </div>
    </section>
  )
}
