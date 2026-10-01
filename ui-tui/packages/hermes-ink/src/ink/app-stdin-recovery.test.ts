import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './components/App.js'
import { da1 } from './terminal-querier.js'

// Regression for issue #31486: when processInput throws inside the
// handleReadable read loop, any bytes still buffered in stdin are stranded
// because Node only emits 'readable' on buffer transitions, not for data
// the consumer has already been notified about. Without a re-pump, the
// TUI freezes; stdin appears wedged while the agent loop keeps running.

const makeFakeStdin = (initialChunks: Array<string | null>) => {
  const queue: Array<string | null> = [...initialChunks]
  const readableListeners: Array<() => void> = []

  return {
    addListener: vi.fn((event: string, fn: () => void) => {
      if (event === 'readable') {
        readableListeners.push(fn)
      }
    }),
    listeners: vi.fn((event: string) => (event === 'readable' ? [...readableListeners] : [])),
    read: vi.fn(() => (queue.length > 0 ? queue.shift()! : null)),
    get readableLength() {
      return queue.filter(c => c !== null).reduce((n, c) => n + (c as string).length, 0)
    }
  }
}

const noopStream = { isTTY: false, write: () => true } as unknown as NodeJS.WriteStream

const makeApp = (stdin: ReturnType<typeof makeFakeStdin>) => {
  // Construct a real App instance with minimal props. PureComponent only
  // stores `props`; class-field arrows (including handleReadable) bind to
  // the instance during construction.
  const app = new App({
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: noopStream,
    stderr: noopStream,
    exitOnCtrlC: false,
    onExit: vi.fn(),
    terminalColumns: 80,
    terminalRows: 24,
    selection: undefined as any,
    onSelectionChange: vi.fn(),
    onClickAt: vi.fn(() => false),
    onMouseDownAt: vi.fn(() => undefined),
    onMouseUpAt: vi.fn(),
    onMouseDragAt: vi.fn(),
    onHoverAt: vi.fn(),
    onCopySelectionNoClear: vi.fn(async () => ''),
    getSelectedText: vi.fn(() => ''),
    getHyperlinkAt: vi.fn(() => undefined),
    onOpenHyperlink: vi.fn(),
    onMultiClick: vi.fn(),
    onSelectionDrag: vi.fn(),
    onStdinResume: vi.fn(),
    dispatchKeyboardEvent: vi.fn(),
    children: null as any
  } as any)

  ;(app as any).rawModeEnabledCount = 1

  return app
}

describe('App.handleReadable error recovery (issue #31486)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-pumps the readable handler when bytes remain buffered after a throw', () => {
    const stdin = makeFakeStdin(['boom', 'queued-keystroke', null])
    const app = makeApp(stdin)

    let calls = 0

    ;(app as any).processInput = vi.fn((chunk: string) => {
      calls++

      if (calls === 1) {
        throw new Error('synthetic processInput failure')
      }

      void chunk
    })
    ;(app as any).handleReadable()

    // First handler run threw mid-loop. The remaining chunk is still in
    // the fake stdin buffer; without the re-pump, Node would never call
    // the listener again because no new bytes arrive.
    expect((app as any).processInput).toHaveBeenCalledTimes(1)

    vi.runAllTimers()

    expect((app as any).processInput).toHaveBeenCalledTimes(2)
    expect((app as any).processInput).toHaveBeenLastCalledWith('queued-keystroke')
  })

  it('does not re-pump when raw mode has been fully disabled during recovery', () => {
    const stdin = makeFakeStdin(['boom', 'stranded', null])

    const app = makeApp(stdin)

    ;(app as any).processInput = vi.fn(() => {
      // Simulate a useInput handler that disabled raw mode and threw.
      ;(app as any).rawModeEnabledCount = 0
      throw new Error('synthetic')
    })
    ;(app as any).handleReadable()
    vi.runAllTimers()

    expect((app as any).processInput).toHaveBeenCalledTimes(1)
  })
})

describe('App split terminal-query response recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a bare ESC buffered for a pending DA1 reply and never dispatches its CSI tail as input', async () => {
    const app = makeApp(makeFakeStdin([]))
    const dispatchKeyboardEvent = app.props.dispatchKeyboardEvent as ReturnType<typeof vi.fn>
    const pending = app.querier.send(da1())

    app.processInput('\x1b')
    await vi.advanceTimersByTimeAsync(app.NORMAL_TIMEOUT)

    // The ordinary ESC timeout has elapsed, but the pending terminal query
    // owns one bounded grace period. No Escape or partial CSI is input.
    expect(dispatchKeyboardEvent).not.toHaveBeenCalled()
    expect(app.keyParseState.incomplete).toBe('\x1b')

    // The remote continuation can arrive well after the old 250 ms grace
    // window, for example after a busy renderer/event-loop turn.
    await vi.advanceTimersByTimeAsync(500)
    app.processInput('[?4;6;7;14;21;22;23;24;28;32;42;52c')
    await expect(pending).resolves.toMatchObject({ type: 'da1' })

    expect(dispatchKeyboardEvent).not.toHaveBeenCalled()
    expect(app.keyParseState.incomplete).toBe('')
  })

  it('dispatches a normal bare Escape after the ordinary timeout when no terminal query is pending', async () => {
    const app = makeApp(makeFakeStdin([]))
    const dispatchKeyboardEvent = app.props.dispatchKeyboardEvent as ReturnType<typeof vi.fn>

    app.processInput('\x1b')
    await vi.advanceTimersByTimeAsync(app.NORMAL_TIMEOUT)

    expect(dispatchKeyboardEvent).toHaveBeenCalledTimes(1)
  })

  it('dispatches a user Escape once after the bounded query-response grace expires', async () => {
    const app = makeApp(makeFakeStdin([]))
    const dispatchKeyboardEvent = app.props.dispatchKeyboardEvent as ReturnType<typeof vi.fn>
    void app.querier.send(da1())

    app.processInput('\x1b')
    await vi.advanceTimersByTimeAsync(app.NORMAL_TIMEOUT + app.QUERY_RESPONSE_ESC_GRACE_TIMEOUT)

    expect(dispatchKeyboardEvent).toHaveBeenCalledTimes(1)
  })
})
