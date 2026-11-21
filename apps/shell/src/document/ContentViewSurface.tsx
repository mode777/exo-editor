import { useCallback, useRef } from 'react'
import { usePluginHost, useViewPoolSnapshot, useWorkspaceRuntime } from '../workspace/context'
import type { ContentViewTabInfo } from '../workbench/tabs'

/**
 * The shell-owned body for one content-view tab. The iframe is positioned by
 * the view pool over the placeholder; the tab strip carries the title, plugin
 * name and close control, so the surface adds no second header.
 */
export function ContentViewSurface({ content }: { content: ContentViewTabInfo }) {
  const runtime = useWorkspaceRuntime()
  const host = usePluginHost()
  const handles = useViewPoolSnapshot()
  const handle = handles.find((entry) => entry.key === content.key)
  const record = host.records.find((entry) => entry.identity === content.identity)
  const view = record?.contentViews.find((entry) => entry.id === content.viewId)
  const current = useRef({ content })
  current.current = { content }

  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      const key = current.current.content.key
      runtime.views.attachContentSurface(key, element)
    },
    [runtime],
  )

  const missing = !record || !view
  return (
    <div className="exo-view-surface exo-content-view">
      {missing ? (
        <div className="exo-view-missing" role="status">
          This content view is no longer available.
        </div>
      ) : (
        <>
          {handle?.phase === 'failed' && (
            <div className="exo-view-error" role="alert">
              <span>{handle.error?.message ?? 'The content view could not start.'}</span>
              <button type="button" onClick={() => runtime.views.retry(content.key)}>
                Retry
              </button>
            </div>
          )}
          <div
            ref={attach}
            className="exo-view-placeholder"
            role="region"
            aria-label={`${content.title} — ${content.pluginName}`}
          />
        </>
      )}
    </div>
  )
}
