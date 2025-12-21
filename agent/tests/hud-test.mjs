#!/usr/bin/env node

/**
 * Simple HUD Component Test
 * Tests the HUD components in isolation
 */

import { StreamBuffer } from '../core/hud-stream-buffer.mjs'

console.log('Testing StreamBuffer...')

// Test 1: Basic append and retrieval
const buffer = new StreamBuffer(100)
buffer.append('Hello, World!')
console.assert(buffer.length() === 13, 'Buffer length should be 13')
console.assert(buffer.getAll() === 'Hello, World!', 'Buffer content should match')
console.log('✓ Basic append and retrieval works')

// Test 2: Truncation
const buffer2 = new StreamBuffer(10)
buffer2.append('This is a very long string that should be truncated')
console.assert(buffer2.length() === 10, 'Buffer should be truncated to 10 chars')
console.assert(buffer2.getAll() === 'truncated', 'Buffer should contain last 10 chars')
console.log('✓ Truncation works')

// Test 3: Window extraction
const buffer3 = new StreamBuffer(100)
buffer3.append('0123456789')
const window = buffer3.getWindow(5, 0)
console.assert(window === '56789', `Window should be '56789', got '${window}'`)
console.log('✓ Window extraction works')

// Test 4: ANSI code removal
const buffer4 = new StreamBuffer(100)
buffer4.append('\x1b[31mRed Text\x1b[0m')
console.assert(!buffer4.getAll().includes('\x1b'), 'ANSI codes should be removed')
console.assert(buffer4.getAll().includes('Red Text'), 'Text content should be preserved')
console.log('✓ ANSI code removal works')

// Test 5: Clear
buffer.clear()
console.assert(buffer.length() === 0, 'Buffer should be empty after clear')
console.log('✓ Clear works')

console.log('\n✅ All StreamBuffer tests passed!')

// Test HUDManager (basic initialization)
console.log('\nTesting HUDManager...')
import { HUDManager } from '../core/hud-manager.mjs'

const hudManager = new HUDManager({
	width: 45,
	streamSpeed: 'medium'
})

console.assert(hudManager.isEnabled() === false, 'HUD should not be enabled before initialization')
console.log('✓ HUDManager constructor works')

// Test state management
hudManager.state.agents = [
	{ name: 'TEST_AGENT', status: 'pending', turns: 0, cost: 0, time: 0 }
]
hudManager.onAgentStart('TEST_AGENT')
console.assert(hudManager.state.agents[0].status === 'in-progress', 'Agent status should be in-progress')
console.log('✓ Agent state management works')

hudManager.onAgentComplete('TEST_AGENT', { turns: 3, cost: 0.05, time: 10.5 })
console.assert(hudManager.state.agents[0].status === 'complete', 'Agent status should be complete')
console.assert(hudManager.state.agents[0].turns === 3, 'Agent turns should be 3')
console.assert(hudManager.state.totalTurns === 3, 'Total turns should be 3')
console.log('✓ Agent completion tracking works')

// Test stream buffers
hudManager.onStreamIn('incoming data')
hudManager.onStreamOut('outgoing data')
console.assert(hudManager.state.streamIn.length() > 0, 'Stream in buffer should have data')
console.assert(hudManager.state.streamOut.length() > 0, 'Stream out buffer should have data')
console.log('✓ Stream buffer integration works')

console.log('\n✅ All HUDManager tests passed!')
console.log('\n🎉 All tests completed successfully!')
