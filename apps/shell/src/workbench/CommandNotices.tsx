import { useCommandNotices, useWorkspaceRuntime } from '../workspace/context'

/**
 * Workspace-scoped, non-blocking command notices. The controller owns the text,
 * the 200-character bound and the auto-dismiss timer; this is presentation only.
 */
export function CommandNotices() {
  const runtime = useWorkspaceRuntime()
  const snapshot = useCommandNotices()
  if (snapshot.notices.length === 0) return null
  return (
    <section className="exo-command-notices" role="status" aria-label="Plugin command notices">
      {snapshot.notices.map((notice) => (
        <div className="exo-command-notice" key={notice.id}>
          <span className="exo-command-notice-text">{notice.message}</span>
          <button
            type="button"
            className="exo-command-notice-dismiss"
            aria-label={`Dismiss notice from ${notice.pluginName}`}
            onClick={() => runtime.commands.dismissNotice(notice.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </section>
  )
}
