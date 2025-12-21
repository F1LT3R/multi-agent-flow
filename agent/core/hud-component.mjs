import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'

/**
 * HUD Component
 * Renders the terminal HUD using Ink (React for CLIs)
 */
const HUDComponent = ({ getState }) => {
	const [state, setState] = useState(getState())
	const [scrollPosIn, setScrollPosIn] = useState(0)
	const [scrollPosOut, setScrollPosOut] = useState(0)

	// Update state from parent
	useEffect(() => {
		const interval = setInterval(() => {
			setState(getState())
		}, 50) // Update at 20fps for smooth display

		return () => clearInterval(interval)
	}, [getState])

	// Animate incoming stream (left to right scroll)
	useEffect(() => {
		const interval = setInterval(() => {
			setScrollPosIn(prev => {
				const bufferLen = state.streamInBuffer?.length || 0
				if (bufferLen === 0) return 0
				// Smooth scroll to show latest
				const target = Math.max(0, bufferLen - STREAM_WINDOW_SIZE)
				const delta = target - prev
				if (Math.abs(delta) < 1) return target
				return prev + delta * 0.3 // Smooth easing
			})
		}, 50)

		return () => clearInterval(interval)
	}, [state.streamInBuffer])

	// Animate outgoing stream (right to left scroll)
	useEffect(() => {
		const interval = setInterval(() => {
			setScrollPosOut(prev => {
				const bufferLen = state.streamOutBuffer?.length || 0
				if (bufferLen === 0) return 0
				// Smooth scroll to show latest
				const target = Math.max(0, bufferLen - STREAM_WINDOW_SIZE)
				const delta = target - prev
				if (Math.abs(delta) < 1) return target
				return prev + delta * 0.3 // Smooth easing
			})
		}, 50)

		return () => clearInterval(interval)
	}, [state.streamOutBuffer])

	const width = state.width || 45
	const STREAM_WINDOW_SIZE = width - 8 // Account for borders and labels

	// Calculate total time
	const totalTime = state.flowStartTime
		? ((Date.now() - state.flowStartTime) / 1000).toFixed(1)
		: '0.0'

	// Get stream windows
	const streamInText = getStreamWindow(
		state.streamInBuffer || '',
		scrollPosIn,
		STREAM_WINDOW_SIZE,
		'ltr'
	)

	const streamOutText = getStreamWindow(
		state.streamOutBuffer || '',
		scrollPosOut,
		STREAM_WINDOW_SIZE,
		'rtl'
	)

	// Format cost
	const formatCost = (cost) => {
		if (cost === 0) return '-'
		return `$${cost.toFixed(4)}`
	}

	// Format time
	const formatTime = (time) => {
		if (time === 0) return '-'
		return `${time.toFixed(1)}s`
	}

	// Format turns
	const formatTurns = (turns) => {
		if (turns === 0) return '-'
		return `${turns}t`
	}

	// Status icons
	const getStatusIcon = (status) => {
		switch (status) {
			case 'complete': return '✓'
			case 'in-progress': return '▶'
			case 'pending': return '○'
			default: return '?'
		}
	}

	// Status colors
	const getStatusColor = (status) => {
		switch (status) {
			case 'complete': return 'green'
			case 'in-progress': return 'cyan'
			case 'pending': return 'gray'
			default: return 'white'
		}
	}

	return React.createElement(
		Box,
		{
			flexDirection: "column",
			borderStyle: "round",
			borderColor: "cyan",
			paddingX: 1,
			width: width
		},
		// Header
		React.createElement(Text, { bold: true, color: "cyan" }, "AGENT FLOW"),

		// Agent List
		...(state.agents?.map((agent, idx) =>
			React.createElement(
				Box,
				{ key: idx, flexDirection: "row" },
				React.createElement(
					Text,
					{ color: getStatusColor(agent.status) },
					`${getStatusIcon(agent.status)} ${agent.displayName.padEnd(18)}`
				),
				React.createElement(
					Text,
					{ color: "white" },
					`${formatTurns(agent.turns).padStart(3)} ${formatCost(agent.cost).padStart(8)} ${formatTime(agent.time).padStart(6)}`
				)
			)
		) || []),

		// Divider
		React.createElement(Text, { color: "cyan" }, '─'.repeat(width - 4)),

		// Stream Display - IN
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Text, { color: "green" }, "IN  → "),
			React.createElement(Text, { color: "gray" }, streamInText)
		),

		// Stream Display - OUT
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Text, { color: "yellow" }, "OUT ← "),
			React.createElement(Text, { color: "gray" }, streamOutText)
		),

		// Divider
		React.createElement(Text, { color: "cyan" }, '─'.repeat(width - 4)),

		// Totals
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Text, { bold: true, color: "white" }, "TOTAL: "),
			React.createElement(
				Text,
				{ color: "white" },
				`${state.totalTurns} turns  ${formatCost(state.totalCost)}  ${totalTime}s`
			)
		)
	)
}

/**
 * Get a window of text from the stream buffer
 * @param {string} buffer - Full buffer text
 * @param {number} scrollPos - Current scroll position
 * @param {number} windowSize - Size of the window
 * @param {string} direction - 'ltr' or 'rtl'
 */
function getStreamWindow(buffer, scrollPos, windowSize, direction) {
	if (!buffer || buffer.length === 0) {
		return ''.padEnd(windowSize, ' ')
	}

	// Get the window of text
	const start = Math.floor(Math.max(0, Math.min(scrollPos, buffer.length - windowSize)))
	const end = Math.min(start + windowSize, buffer.length)
	let text = buffer.slice(start, end)

	// For RTL, reverse the text visually
	if (direction === 'rtl') {
		text = text.split('').reverse().join('')
	}

	// Pad to window size
	return text.padEnd(windowSize, ' ')
}

export default HUDComponent
