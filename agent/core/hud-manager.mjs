import { render } from 'ink'
import React from 'react'
import { StreamBuffer } from './hud-stream-buffer.mjs'

/**
 * HUD Manager
 * Manages the terminal HUD state and rendering
 */
export class HUDManager {
	constructor(options = {}) {
		this.options = {
			width: options.width || 45,
			streamSpeed: options.streamSpeed || 'medium',
			updateInterval: options.updateInterval || 100,
			...options
		}

		this.enabled = false
		this.inkInstance = null
		this.state = {
			agents: [],
			streamIn: new StreamBuffer(1024),
			streamOut: new StreamBuffer(1024),
			totalCost: 0,
			totalTurns: 0,
			totalTime: 0,
			flowStartTime: null,
			currentAgentStartTime: null
		}

		// Bind methods for callbacks
		this.onAgentStart = this.onAgentStart.bind(this)
		this.onAgentComplete = this.onAgentComplete.bind(this)
		this.onStreamIn = this.onStreamIn.bind(this)
		this.onStreamOut = this.onStreamOut.bind(this)
		this.onTurnUpdate = this.onTurnUpdate.bind(this)
	}

	/**
	 * Initialize the HUD
	 */
	async initialize(flowConfig, agentConfigs) {
		// Check if HUD should be enabled
		if (process.env.FLOW_DISABLE_HUD === 'true' || !process.stdout.isTTY) {
			this.enabled = false
			return
		}

		this.enabled = true
		this.state.flowStartTime = Date.now()

		// Initialize agent list from flow configuration
		const agentNames = flowConfig.agents || []
		this.state.agents = agentNames.map(name => {
			const config = agentConfigs.find(a => a.name === name)
			return {
				name,
				displayName: this._truncateName(name, 18),
				status: 'pending', // pending, in-progress, complete
				turns: 0,
				cost: 0,
				time: 0,
				goal: config?.goal || ''
			}
		})

		// Start rendering
		await this._startRendering()
	}

	/**
	 * Start the Ink rendering
	 */
	async _startRendering() {
		// Dynamically import the HUD component
		const { default: HUDComponent } = await import('./hud-component.mjs')

		// Create a state updater function that the component can use
		const getState = () => ({
			...this.state,
			streamInBuffer: this.state.streamIn.getAll(),
			streamOutBuffer: this.state.streamOut.getAll(),
			width: this.options.width,
			streamSpeed: this.options.streamSpeed
		})

		// Render the component
		this.inkInstance = render(
			React.createElement(HUDComponent, { getState })
		)

		// Set up periodic updates
		this.updateInterval = setInterval(() => {
			if (this.inkInstance) {
				this.inkInstance.rerender(
					React.createElement(HUDComponent, { getState })
				)
			}
		}, this.options.updateInterval)
	}

	/**
	 * Check if HUD is enabled
	 */
	isEnabled() {
		return this.enabled
	}

	/**
	 * Handle agent start event
	 */
	onAgentStart(agentName) {
		const agent = this.state.agents.find(a => a.name === agentName)
		if (agent) {
			agent.status = 'in-progress'
			this.state.currentAgentStartTime = Date.now()
		}
	}

	/**
	 * Handle agent complete event
	 */
	onAgentComplete(agentName, metrics) {
		const agent = this.state.agents.find(a => a.name === agentName)
		if (agent) {
			agent.status = 'complete'
			agent.turns = metrics.turns || 0
			agent.cost = metrics.cost || 0
			agent.time = metrics.time || 0

			// Update totals
			this.state.totalTurns += agent.turns
			this.state.totalCost += agent.cost
		}

		this.state.currentAgentStartTime = null
	}

	/**
	 * Handle turn update (for real-time turn counting)
	 */
	onTurnUpdate(agentName, turnNumber) {
		const agent = this.state.agents.find(a => a.name === agentName)
		if (agent && agent.status === 'in-progress') {
			agent.turns = turnNumber
		}
	}

	/**
	 * Handle incoming stream data
	 */
	onStreamIn(chunk) {
		this.state.streamIn.append(chunk)
	}

	/**
	 * Handle outgoing stream data
	 */
	onStreamOut(chunk) {
		this.state.streamOut.append(chunk)
	}

	/**
	 * Get current total elapsed time
	 */
	getTotalTime() {
		if (!this.state.flowStartTime) return 0
		return (Date.now() - this.state.flowStartTime) / 1000
	}

	/**
	 * Get current agent elapsed time
	 */
	getCurrentAgentTime() {
		if (!this.state.currentAgentStartTime) return 0
		return (Date.now() - this.state.currentAgentStartTime) / 1000
	}

	/**
	 * Truncate agent name for display
	 */
	_truncateName(name, maxLen) {
		if (name.length <= maxLen) return name
		return name.slice(0, maxLen - 3) + '...'
	}

	/**
	 * Clean up and destroy the HUD
	 */
	async destroy() {
		if (!this.enabled) return

		// Stop update interval
		if (this.updateInterval) {
			clearInterval(this.updateInterval)
			this.updateInterval = null
		}

		// Unmount Ink component
		if (this.inkInstance) {
			this.inkInstance.unmount()
			this.inkInstance = null
		}

		this.enabled = false
	}
}
