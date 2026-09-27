import { useCallback, useEffect, useState, type FormEvent } from 'react'
import north from '../assets/north.png'
import './compass.css'

type Provider = 'bob' | 'openai'
interface Session { configured: boolean; user: { login: string } | null; csrf?: string; installUrl: string | null }
interface Run { id: number; pr: number; sha: string; stage: string; message: string; createdAt: string; usage: string | null }
interface Repo {
  id: number; installationId: number; fullName: string; private: boolean; jobs: Run[]
  settings: { enabled: boolean; provider: Provider; model: string; maxBobcoins: number; maxOutputTokens: number; dailyRuns: number } | null
}
const stageLabels: Record<string, string> = { queued: 'Queued', gathering: 'Gathering context', analyzing: 'Analyzing', posting: 'Posting brief', posted: 'Brief posted', failed: 'Needs attention', skipped: 'Skipped', interrupted: 'Interrupted' }

export default function CompassApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState('')
  const [provider, setProvider] = useState<Provider>('bob')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4.1-mini')
  const [bobcoins, setBobcoins] = useState('0.5')
  const [tokens, setTokens] = useState('2048')
  const [dailyRuns, setDailyRuns] = useState('5')
  const [license, setLicense] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const repo = repos.find(r => String(r.id) === selected)

  const request = useCallback(async (path: string, payload?: unknown) => {
    const response = await fetch(path, { credentials: 'same-origin', ...(payload !== undefined ? {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf ?? '' }, body: JSON.stringify(payload),
    } : {}) })
    const data = await response.json() as { error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Request failed. Please try again.')
    return data
  }, [session?.csrf])

  useEffect(() => {
    let active = true
    fetch('/api/session', { credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error('Could not connect to Compass. Please refresh.')
      return response.json() as Promise<Session>
    }).then(data => { if (active) setSession(data) }).catch(() => { if (active) setError('The Compass service is unavailable. Start the service and refresh this page.') })
    return () => { active = false }
  }, [])

  const loadRepositories = useCallback(async () => {
    const data = await request('/api/repositories') as unknown as { repositories: Repo[] }
    setRepos(data.repositories)
    setSelected(previous => previous && data.repositories.some(r => String(r.id) === previous) ? previous : String(data.repositories[0]?.id ?? ''))
  }, [request])

  useEffect(() => {
    if (!session?.user) return
    setLoadingRepos(true)
    void loadRepositories().catch(e => setError((e as Error).message)).finally(() => setLoadingRepos(false))
    const timer = setInterval(() => { void loadRepositories().catch(e => setError((e as Error).message)) }, 15_000)
    return () => clearInterval(timer)
  }, [session?.user, loadRepositories])

  useEffect(() => {
    setApiKey(''); setConsent(false); setLicense(false); setNotice('')
    const settings = repos.find(r => String(r.id) === selected)?.settings
    if (settings) {
      setProvider(settings.provider); setModel(settings.model); setBobcoins(String(settings.maxBobcoins))
      setTokens(String(settings.maxOutputTokens)); setDailyRuns(String(settings.dailyRuns))
    }
    // Reset connection inputs only when switching repositories, not while polling runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  async function enable(event: FormEvent) {
    event.preventDefault()
    if (!repo) return
    setBusy(true); setError(''); setNotice('')
    try {
      await request('/api/settings', { repositoryId: repo.id, installationId: repo.installationId, provider, apiKey, model,
        maxBobcoins: Number(bobcoins), maxOutputTokens: Number(tokens), dailyRuns: Number(dailyRuns), acceptLicense: license, consent })
      setApiKey(''); setConsent(false); setLicense(false)
      await loadRepositories()
      setNotice('Automation enabled. Open or update an eligible PR to get your first brief. Your key will be verified on that run.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function change(action: 'pause' | 'resume' | 'disconnect') {
    if (!repo) return
    setBusy(true); setError(''); setNotice('')
    try {
      await request(`/api/repositories/${repo.id}/${action}`, action === 'resume' ? { consent: true } : {})
      await loadRepositories()
      setNotice(action === 'disconnect' ? 'Model key removed and automation disconnected for this repository.' : action === 'pause' ? 'Automation paused. An in-flight model request may still incur usage.' : 'Automation resumed with the saved provider and limits.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function logout() {
    try { await request('/api/logout', {}); setSession(previous => previous ? { ...previous, user: null, csrf: undefined } : null); setRepos([]); setSelected(''); setApiKey('') }
    catch (e) { setError((e as Error).message) }
  }

  return <div className="compass-app">
    <nav className="compass-nav" aria-label="Main navigation">
      <a className="wordmark" href="/" aria-label="Compass home"><span className="compass-symbol">↗</span> compass<span className="wordmark-dot">.</span></a>
      <div className="nav-links"><a href="#how-it-works">How it works</a><a href="/demo">Example brief ↗</a>
        {session?.user ? <button className="text-button" onClick={() => { void logout() }}>Sign out @{session.user.login}</button> : <a className="small-cta" href="#connect">Get Compass <span>↗</span></a>}
      </div>
    </nav>
    <main className="compass-main">
      <section className="compass-hero">
        <div className="hero-copy"><div className="eyebrow"><span className="tiny-star">✳</span> A LITTLE CONTEXT. A BETTER REVIEW.</div>
          <h1>Find your way<br />through every <span>pull request.</span></h1>
          <p>Meet North, your guide to the diff. Connect your repo and your model. Compass brings the context to you, right where you review.</p>
          <a href="#connect" className="primary-button">Set up Compass <span>↗</span></a><span className="hero-note">Your model. Your repositories. Your call.</span>
        </div>
        <div className="north-scene" aria-label="North, your Compass guide">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <span className="direction direction-n">N</span><span className="direction direction-e">E</span><span className="scene-star">✧</span>
          <div className="north-disc"><img src={north} alt="North, a friendly white bear wearing a compass" /></div>
          <div className="north-label"><span className="status-dot" /> MEET NORTH <span>your guide to the diff</span></div>
        </div>
      </section>
      <section className="how-strip" id="how-it-works" aria-label="How Compass works">
        <div><span className="step-number">01</span><div><h2>Connect once</h2><p>Choose your repositories and model.</p></div></div>
        <span className="step-arrow">→</span><div><span className="step-number">02</span><div><h2>Open a pull request</h2><p>North gathers context automatically.</p></div></div>
        <span className="step-arrow">→</span><div><span className="step-number">03</span><div><h2>Review with context</h2><p>A clear brief, with links to the code.</p></div></div>
      </section>
      <div className="workspace-grid" id="connect">
        <section className="setup-panel">
          <div className="section-kicker">YOUR COMPASS, CONNECTED</div><h2>A little setup. A clearer diff.</h2>
          <p className="section-intro">You choose where North goes and which model comes along.</p>
          {error && <div className="feedback error" role="alert">{error}</div>}
          {notice && <div className="feedback success" role="status">{notice}</div>}
          {session && !session.configured && <div className="feedback setup-notice" role="status"><strong>This is your local Compass preview.</strong> GitHub connection becomes available once the Compass service is registered and deployed. No accounts are connected and no model calls are being made.</div>}
          <div className="setup-step"><div className={`number-circle ${session?.user ? 'complete' : ''}`}>{session?.user ? '✓' : '1'}</div><div className="step-content">
            <h3>Connect GitHub</h3><p>Choose the repositories Compass can read and comment on.</p>
            {session?.user ? <div className="connected-account"><span className="status-dot" /> Connected as <strong>@{session.user.login}</strong>{session.installUrl && <a href={session.installUrl}>Manage repositories ↗</a>}</div>
              : <a className={`github-button ${!session?.configured ? 'disabled-link' : ''}`} href={session?.configured ? '/auth/github' : undefined} aria-disabled={!session?.configured}>Connect with GitHub <span>↗</span></a>}
            {session?.user && <><label htmlFor="repository">Repository</label><select id="repository" value={selected} onChange={e => setSelected(e.target.value)} disabled={loadingRepos || busy}>
              <option value="">{loadingRepos ? 'Finding your repositories…' : 'Select a repository'}</option>
              {repos.map(r => <option key={r.id} value={r.id}>{r.fullName}{r.private ? ' · Private' : ''}</option>)}
            </select>{!loadingRepos && repos.length === 0 && <p className="field-note">Install Compass on a repository you administer, then <button type="button" className="text-button" onClick={() => { void loadRepositories().catch(e => setError((e as Error).message)) }}>refresh repositories</button>.</p>}</>}
          </div></div>
          {repo?.settings && <div className="automation-state"><div><span className={`status-dot ${repo.settings.enabled ? '' : 'paused'}`} /><strong>Automation {repo.settings.enabled ? 'enabled' : 'paused'}</strong><p>{repo.settings.provider === 'bob' ? 'IBM Bob' : `OpenAI · ${repo.settings.model}`} · up to {repo.settings.dailyRuns} runs / day</p></div>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { void change(repo.settings?.enabled ? 'pause' : 'resume') }}>{repo.settings.enabled ? 'Pause' : 'Resume automation'}</button>
            <button type="button" className="text-button danger" disabled={busy} onClick={() => { void change('disconnect') }}>Remove key & disconnect</button>
            {!repo.settings.enabled && <p className="field-note full-width">Resuming authorizes future PR context processing and comments using your saved model key and limits.</p>}
          </div>}
          <form onSubmit={event => { void enable(event) }}>
            <fieldset disabled={!repo || busy}>
              <div className="setup-step"><div className="number-circle">2</div><div className="step-content"><h3>Bring your model</h3><p>Your credentials stay encrypted on the Compass service.</p>
                <div className="provider-options" role="group" aria-label="Model provider"><button type="button" aria-pressed={provider === 'bob'} onClick={() => { setProvider('bob'); setApiKey(''); setConsent(false) }}><span className="provider-icon">B</span><strong>IBM Bob</strong><span>Bob Shell</span></button><button type="button" aria-pressed={provider === 'openai'} onClick={() => { setProvider('openai'); setApiKey(''); setConsent(false) }}><span className="provider-icon">◎</span><strong>OpenAI</strong><span>Responses API</span></button></div>
                <label htmlFor="api-key">{provider === 'bob' ? 'Bob Inference API key' : 'OpenAI API key'}{repo?.settings && <span> · enter a key to replace this connection</span>}</label>
                <input id="api-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" placeholder="Paste your API key" required minLength={10} maxLength={4096} />
                <p className="field-note">The key is never sent back to your browser. Account access is verified on the first run; saving it does not spend credits.</p>
                {provider === 'openai' && <><label htmlFor="model">Model ID</label><input id="model" value={model} onChange={e => setModel(e.target.value)} required pattern="[a-zA-Z0-9._:\-]+" maxLength={100} /><p className="field-note">Use a model available to your API account that supports Responses and JSON output.</p></>}
              </div></div>
              <div className="setup-step last-step"><div className="number-circle">3</div><div className="step-content"><h3>Set your boundaries</h3><p>Enable briefs for PRs opened, updated, reopened, or marked ready.</p>
                <div className="limit-fields"><div><label htmlFor="per-run">{provider === 'bob' ? 'Requested Bobcoins / run' : 'Maximum output tokens / run'}</label><input id="per-run" type="number" required min={provider === 'bob' ? '0.01' : '256'} max={provider === 'bob' ? '1' : '4096'} step={provider === 'bob' ? '0.01' : '1'} value={provider === 'bob' ? bobcoins : tokens} onChange={e => provider === 'bob' ? setBobcoins(e.target.value) : setTokens(e.target.value)} /></div>
                  <div><label htmlFor="daily-runs">Maximum runs / day (UTC)</label><input id="daily-runs" type="number" min="1" max="100" step="1" required value={dailyRuns} onChange={e => setDailyRuns(e.target.value)} /></div></div>
                <p className="field-note">{provider === 'bob' ? 'Bob’s cost flag is a requested limit, not a verified billing guarantee.' : 'Token limits are not a dollar cap. Configure provider-side spending controls too.'} Failed model attempts count toward the daily limit. No repair calls or automatic paid retries.</p>
                {provider === 'bob' && <label className="check-label"><input type="checkbox" required checked={license} onChange={e => setLicense(e.target.checked)} /><span>I accept IBM Bob’s license for automated sessions using my key.</span></label>}
                <label className="check-label"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I authorize Compass to send PR code and context from <strong>{repo?.fullName ?? 'my selected repository'}</strong> to {provider === 'bob' ? 'IBM Bob' : 'OpenAI'}, incur model usage within these controls, and post brief comments automatically.</span></label>
                <button type="submit" className="primary-button enable-button" disabled={!repo || !consent || !apiKey || (provider === 'bob' && !license) || busy}>{busy ? 'Saving connection…' : repo?.settings ? 'Save & enable automation' : 'Enable automatic briefs'}<span>↗</span></button>
                <p className="fine-print">Draft, fork, and bot-authored PRs are skipped. You can pause or disconnect at any time.</p>
              </div></div>
            </fieldset>
          </form>
        </section>
        <aside className="context-sidebar">
          <section className="brief-preview"><div className="preview-top"><span className="section-kicker">WHAT LANDS ON YOUR PR</span><span className="example-tag">Example</span></div>
            <div className="comment-author"><img src={north} alt="" /><div><strong>Compass</strong><span>Your guide to this change</span></div><span className="bot-badge">bot</span></div>
            <h3>A small change. The context you need.</h3><div className="brief-section"><h4>Purpose</h4><p>Match search queries to document titles, so snippet-only matches no longer appear.</p></div>
            <div className="brief-section"><h4>Relevant context</h4><p>Case-insensitive matching and the empty-results response stay the same.</p></div>
            <div className="brief-section"><h4>Suggested reading order</h4><ol><li><span>searchService.ts</span><small>Start with the matching logic.</small></li><li><span>searchService.test.ts</span><small>Then check the regression coverage.</small></li></ol></div>
            <div className="preview-footer">Illustrative content · every live brief links to its sources</div>
          </section>
          <section className="progress-card"><span className="section-kicker">FOLLOW NORTH’S PROGRESS</span><div className="progress-track"><span>Queued</span><span>Gathering</span><span>Analyzing</span><span>Posted ✓</span></div><p>Watch the Compass check on your PR. New commits get a fresh brief in the same bot comment.</p></section>
          <section className="promise"><span>↗</span><div><h3>Context for your judgment.</h3><p>Compass doesn’t approve, merge, or edit your code. The final call stays with you.</p></div></section>
        </aside>
      </div>
      <section className="activity-section"><div className="activity-heading"><div><span className="section-kicker">ON THE RADAR</span><h2>Recent activity</h2></div><span className="muted">{repo?.fullName ?? 'Your next review starts here'}</span></div>
        {!repo?.jobs.length ? <div className="empty-activity"><span className="empty-symbol">↗</span><div><h3>No runs yet</h3><p>Once connected, open or update a pull request. North will take it from there.</p></div></div> : <div className="runs-list">{repo.jobs.map(run => <article key={run.id} className="run-row"><div><a href={`https://github.com/${repo.fullName}/pull/${run.pr}`} target="_blank" rel="noreferrer">PR #{run.pr} ↗</a><span className="run-sha">{run.sha.slice(0, 7)}</span><p>{run.message || 'Waiting for Compass to start.'}</p><small>{new Date(run.createdAt).toLocaleString()}{run.usage ? ' · Provider usage recorded; actual cost available from your provider' : ''}</small></div><span className={`run-status run-${run.stage}`}>{stageLabels[run.stage] ?? run.stage}</span></article>)}</div>}
      </section>
    </main><footer className="compass-footer"><a className="wordmark" href="/">↗ compass.</a><span>A clearer starting point for human review.</span><span>Guided by North.</span></footer>
  </div>
}
