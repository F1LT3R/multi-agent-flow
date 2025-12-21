# CLI Realtime HUD Feature

## Overview

The CLI Realtime HUD provides a live, top-right overlay display during agent flow execution, showing:

- **Agent Flow Progress**: Visual list of agents with status indicators
- **Streaming I/O**: Animated character streams (incoming/outgoing)
- **Metrics**: Per-agent and total costs, token counts, turn counts
- **Timing**: Elapsed time for current agent and total flow

## Usage

### Enable/Disable

The HUD is enabled by default when running in a TTY (interactive terminal).

**Disable via CLI flag:**
```bash
flow dev "your task" --no-hud
```

**Disable via environment variable:**
```bash
FLOW_DISABLE_HUD=true flow dev "your task"
```

### Configuration

Configure HUD settings in `.flow/flow.config.mjs`:

```javascript
export default {
  // ... other config ...

  ui: {
    hud: {
      enabled: true,              // Enable realtime HUD
      width: 45,                  // HUD width in characters
      streamSpeed: 'medium',      // slow|medium|fast|veryfast
      updateInterval: 100,        // ms between updates
    },
  },
}
```

### CLI Options

- `--no-hud` - Disable the HUD display
- `--hud-speed <speed>` - Set stream animation speed (slow|medium|fast|veryfast)

## HUD Display

```
╔═══════════════════════════════════════╗
║ AGENT FLOW                            ║
║ ✓ PLAN_WORK        3t  $0.0042  12.3s ║
║ ▶ GENERATE_CODE    2t  $0.0031   8.1s ║
║ ○ REVIEW           -   -         -    ║
╟───────────────────────────────────────╢
║ IN  → [smooth scroll animation...]   ║
║ OUT ← [...animation scrolling back]   ║
╟───────────────────────────────────────╢
║ TOTAL: 5 turns  $0.0073  20.4s        ║
╚═══════════════════════════════════════╝
```

### Status Indicators

- `✓` (green) - Agent completed successfully
- `▶` (cyan) - Agent currently in progress
- `○` (gray) - Agent pending execution

### Stream Display

- **IN** line: Shows incoming data (left-to-right scroll)
- **OUT** line: Shows outgoing data (right-to-left scroll)
- Automatically removes ANSI codes and control characters
- Maintains a circular buffer of the latest 1024 characters
- Smooth scrolling animation to show new data

## Architecture

### Components

1. **StreamBuffer** (`agent/core/hud-stream-buffer.mjs`)
   - Circular buffer for stream data
   - Automatic ANSI code removal
   - Window extraction for display

2. **HUDManager** (`agent/core/hud-manager.mjs`)
   - Central state management
   - Event handling from FlowRunner and DockerAgentExecutor
   - Ink component lifecycle management

3. **HUDComponent** (`agent/core/hud-component.mjs`)
   - React/Ink component for rendering (using React.createElement)
   - Smooth scrolling animations
   - Real-time updates at 20fps

### Integration Points

- **FlowRunner**: Initializes HUD, emits agent start/complete events
- **DockerAgentExecutor**: Streams I/O data to HUD
- **CLI**: Provides command-line options

## Performance

- HUD updates throttled to 100ms intervals
- Stream buffers limited to 1024 chars
- Animation runs at 20fps for smooth display
- Minimal overhead when disabled

## Fallback Behavior

When HUD is disabled or unavailable:
- Falls back to standard line-by-line output
- All metrics still shown in final summary
- No visual degradation

## Testing

Run the HUD component tests:

```bash
node agent/tests/hud-test.mjs
```

This tests:
- StreamBuffer functionality
- HUDManager state management
- Event handling
- Stream integration

## Troubleshooting

### HUD not appearing

1. Check if running in TTY: `echo $TERM`
2. Verify HUD is not disabled: `echo $FLOW_DISABLE_HUD`
3. Check config: `.flow/flow.config.mjs` → `ui.hud.enabled`

### Performance issues

1. Reduce update interval in config: `ui.hud.updateInterval: 200`
2. Use slower stream speed: `--hud-speed slow`
3. Disable HUD for faster execution: `--no-hud`

### Display corruption

1. Ensure terminal supports ANSI codes
2. Try resizing terminal window
3. Restart flow with `--no-hud` if issues persist

## Implementation Details

### Stream Animation

The streaming display uses a hybrid approach:
- Maintains circular buffer of last 1024 characters
- Displays sliding window (40 chars) showing latest data
- Smooth animation when new data arrives
- Incoming stream scrolls left-to-right
- Outgoing stream scrolls right-to-left (reversed text)

### State Management

HUD state is updated via event callbacks:
- `onAgentStart(agentName)` - Mark agent as in-progress
- `onAgentComplete(agentName, metrics)` - Update metrics, mark complete
- `onStreamIn(chunk)` - Append to incoming buffer
- `onStreamOut(chunk)` - Append to outgoing buffer

### Rendering

Uses Ink (React for CLIs) for rendering:
- Component re-renders every 100ms
- Smooth animations via React state
- Efficient updates using React reconciliation
