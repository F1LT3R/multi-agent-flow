import { ProviderFactory, modelSupportsTools } from '/workspace/agent/ai-providers/provider-factory.mjs'
import { callTool, getToolDefinitions } from '/workspace/agent/vm-tools/index.mjs'
import { getCost, getContextWindow, getContextPercent } from '/workspace/agent/data/model-pricing.mjs'
import fs from 'fs/promises'
import { writeFileSync } from 'fs'
import path from 'path'
import { minimatch } from 'minimatch'

// Resolve template placeholders like {{SHARED}} and {{INTENT}}
async function resolveTemplatePlaceholders(content, templateDir, userIntent) {
	const pattern = /\{\{(\w+)\}\}/g
	let resolved = content
	const matches = [...content.matchAll(/\{\{(\w+)\}\}/g)]

	for (const match of matches) {
		const name = match[1]

		// Reserved dynamic placeholder - inject user intent
		if (name === 'INTENT') {
			resolved = resolved.replace(match[0], userIntent || '')
			continue
		}

		// File-based placeholder - load from common/ directory
		const commonPath = path.join(templateDir, 'common', name + '.md')
		try {
			let commonContent = await fs.readFile(commonPath, 'utf-8')
			// Recursively resolve placeholders in the included content
			commonContent = await resolveTemplatePlaceholders(commonContent, templateDir, userIntent)
			resolved = resolved.replace(match[0], commonContent)
		} catch (error) {
			console.error('❌ TEMPLATE ERROR: {{' + name + '}} - ' + error.message + ' (path: ' + commonPath + ')')
		}
	}
	return resolved
}

// Format file constraints for injection into system prompt
function formatFileConstraints(constraints) {
	if (!constraints) return ''
	const lines = ['# File Constraints']
	if (constraints.write_patterns && constraints.write_patterns.length > 0) {
		lines.push('You CAN write files matching: ' + constraints.write_patterns.join(', '))
	} else {
		lines.push('You CANNOT write any files (read-only agent).')
	}
	if (constraints.exclusions && constraints.exclusions.length > 0) {
		lines.push('')
		lines.push('## Exclusions')
		for (const exclusion of constraints.exclusions) {
			lines.push('- ' + exclusion.patterns.join(', ') + ': ' + exclusion.message)
		}
	}
	return lines.join('\n')
}

// Write trace file directly to disk (bypasses stdout JSON serialization limits)
function writeTrace(agentName, flowRun, turn, data) {
	const now = new Date()
	const datePart = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0')
	].join('-')
	const timePart = [
		String(now.getHours()).padStart(2, '0'),
		String(now.getMinutes()).padStart(2, '0'),
		String(now.getSeconds()).padStart(2, '0')
	].join('-')

	const filename = '/project/.flow/traces/' + datePart + '_' + timePart + '_' + agentName + '_r' + flowRun + '-t' + turn + '.md'

	const parts = []
	parts.push('# ' + agentName + ' - Run ' + flowRun + ', Turn ' + turn)
	parts.push('')
	parts.push('**Timestamp**: ' + now.toLocaleString())
	parts.push('**Model**: ' + data.model)
	parts.push('**Flow Run**: ' + flowRun)
	parts.push('**Agent Turn**: ' + turn + '/' + (data.maxTurns || '?'))
	parts.push('')

	// System prompt on first turn
	if (data.systemPrompt) {
		parts.push('## System Prompt')
		parts.push('')
		parts.push('```markdown')
		parts.push(data.systemPrompt)
		parts.push('```')
		parts.push('')
	}

	// User input on first turn
	if (data.userInput) {
		parts.push('## User Input')
		parts.push('')
		parts.push('```')
		parts.push(data.userInput)
		parts.push('```')
		parts.push('')
	}

	// Agent response
	if (data.content) {
		parts.push('## Agent Response')
		parts.push('')
		parts.push(data.content)
		parts.push('')
	}

	// Tool calls
	if (data.toolCalls && data.toolCalls.length > 0) {
		parts.push('## Tool Calls')
		parts.push('')
		data.toolCalls.forEach((call, index) => {
			parts.push('### ' + (index + 1) + '. ' + call.name)
			parts.push('')
			parts.push('**Arguments:**')
			parts.push('```json')
			parts.push(JSON.stringify(call.arguments, null, 2))
			parts.push('```')
			parts.push('')
			if (call.result !== undefined) {
				parts.push('**Result:**')
				parts.push('```json')
				parts.push(JSON.stringify(call.result, null, 2))
				parts.push('```')
				parts.push('')
			}
		})
	}

	// Token usage
	if (data.tokenUsage) {
		parts.push('## Token Usage & Cost')
		parts.push('')
		parts.push('- Prompt: ' + (data.tokenUsage.prompt_tokens || 0))
		parts.push('- Completion: ' + (data.tokenUsage.completion_tokens || 0))
		parts.push('- Total: ' + (data.tokenUsage.total_tokens || 0))
		if (data.cost !== undefined) {
			parts.push('- **Cost: $' + data.cost.toFixed(4) + '**')
		}
		if (data.contextPercent !== undefined) {
			parts.push('- **Context Used: ' + data.contextPercent.toFixed(1) + '%**')
		}
		parts.push('')
	}

	parts.push('**Finish Reason**: ' + (data.finishReason || 'unknown'))
	parts.push('')

	writeFileSync(filename, parts.join('\n'))
}

// Scan project directory for existing files matching pattern and return next number
async function getNextSequentialNumber(prefix, format) {
	try {
		const files = await fs.readdir('/project')
		const pattern = new RegExp(`^${prefix}-(\\d+)\\.${format}$`)
		let maxNum = 0

		for (const file of files) {
			const match = file.match(pattern)
			if (match) {
				const num = parseInt(match[1], 10)
				if (num > maxNum) {
					maxNum = num
				}
			}
		}

		return maxNum + 1
	} catch (error) {
		console.error('[Image Naming] Failed to scan directory:', error.message)
		// Fallback to timestamp-based naming for uniqueness
		return null
	}
}

// Generate image filename based on naming strategy
async function generateImageFilename(prefix, naming, startNumber, index, format) {
	if (naming === 'sequential') {
		// Use the pre-scanned start number + index for this batch
		const num = String(startNumber + index).padStart(3, '0')
		return prefix + '-' + num + '.' + format
	} else if (naming === 'turn-based') {
		// Keep turn-based naming unchanged (uses turn number)
		const turn = Math.floor(startNumber / 100) // Extract turn from startNumber
		return prefix + '-t' + turn + '-' + index + '.' + format
	}
	// Default: sequential
	const num = String(startNumber + index).padStart(3, '0')
	return prefix + '-' + num + '.' + format
}

// Check if file is allowed by constraints
function isFileAllowed(filename, constraints) {
	if (!constraints || !constraints.write_patterns) return true
	if (constraints.write_patterns.length === 0) return false

	// Use minimatch to check patterns
	return constraints.write_patterns.some(pattern => minimatch(filename, pattern))
}

// Get image buffer from URL or base64
async function getImageBuffer(url) {
	if (url.startsWith('data:')) {
		// Extract base64 data
		const match = url.match(/^data:image\/[^;]+;base64,(.+)$/)
		if (match) {
			return Buffer.from(match[1], 'base64')
		}
		throw new Error('Invalid data URI format')
	} else if (url.startsWith('http')) {
		// Download from URL
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error('Failed to download image: ' + response.status)
		}
		return Buffer.from(await response.arrayBuffer())
	}
	throw new Error('Unsupported image URL format: ' + url.substring(0, 50) + '...')
}

// Wrap everything in try-catch to ensure JSON output even on error
async function main() {
	try {
		// Configuration
		const agentConfig = __AGENT_CONFIG__
		const userInput = __USER_INPUT__
		const pricingOverrides = __PRICING_OVERRIDES__

		// Initialize AI provider
		const provider = ProviderFactory.create(agentConfig.model)

		// Load system prompt (convert host path to VM path)
		// Host path: /Users/user/project/.flow/prompts/AGENT.md
		// VM path: /project/.flow/prompts/AGENT.md
		let promptPath = agentConfig.prompt_file
		if (!promptPath.startsWith('/project/')) {
			// Extract relative path after '.flow/prompts/'
			const match = promptPath.match(/\.flow\/prompts\/(.+)$/)
			if (match) {
				promptPath = '/project/.flow/prompts/' + match[1]
			} else {
				// Fallback for old prompts/ path format
				const oldMatch = promptPath.match(/prompts\/(.+)$/)
				if (oldMatch) {
					promptPath = '/project/.flow/prompts/' + oldMatch[1]
				} else {
					// Last fallback: assume it's already a filename
					promptPath = '/project/.flow/prompts/' + promptPath
				}
			}
		}
		let systemPrompt = await fs.readFile(promptPath, 'utf-8')

		// Resolve template placeholders ({{SHARED}}, {{INTENT}}, etc.)
		console.error('[Templating] Resolving placeholders in: ' + promptPath)
		const beforeLen = systemPrompt.length
		systemPrompt = await resolveTemplatePlaceholders(systemPrompt, '/project/.flow/prompts', userInput)
		const hasUnresolved = systemPrompt.includes('{{') && !systemPrompt.includes('{{INTENT}}')
		console.error('[Templating] Before: ' + beforeLen + ' chars, After: ' + systemPrompt.length + ' chars, Unresolved: ' + hasUnresolved)

		// Inject file constraints so agent knows its boundaries upfront
		const constraintSection = formatFileConstraints(agentConfig.file_constraints)
		if (constraintSection) {
			systemPrompt += '\n\n' + constraintSection
			console.error('[Constraints] Injected file constraints into system prompt')
		}

		// Initialize messages
		const messages = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userInput },
		]

		// Get available tools (direct import - no HTTP!)
		// Note: Provider handles conversion to OpenAI format
		const tools = getToolDefinitions(agentConfig.mcp_tools)

		// Determine tool mode (native, prompt, or auto)
		const toolMode = agentConfig.tool_mode || 'native'
		const usePromptTools = toolMode === 'prompt' ||
			(toolMode === 'auto' && tools.length > 0 && !modelSupportsTools(agentConfig.model))

		// If using prompt-based tools, inject instructions into system prompt
		if (usePromptTools && tools.length > 0) {
			const { injectToolInstructions } = await import('/workspace/agent/vm-tools/prompt-tool-instructions.mjs')
			systemPrompt = await injectToolInstructions(systemPrompt, tools, '/project/.flow/prompts')
			console.error('[Tool Mode] Using prompt-based tool emulation')
			// Update system message
			messages[0].content = systemPrompt
		}

		// Result accumulator
		const results = {
			success: false,
			turns: [],
			finalMessage: null,
			error: null,
			messages: [],
			tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		}

		// Turn loop
		let turnCount = 0
		while (turnCount < agentConfig.max_turns) {
			turnCount++

			try {
				// Log turn start to stderr for real-time visibility
				console.error('[Turn ' + turnCount + '/' + agentConfig.max_turns + ']')

				// Call AI provider with settings from agent config
				// For prompt-based tools, pass empty tools array
				const response = await provider.createCompletion(
					messages,
					usePromptTools ? [] : tools,
					agentConfig.settings || {}
				)

			// Accumulate token usage
			if (response.usage) {
				results.tokenUsage.prompt_tokens += response.usage.prompt_tokens || 0
				results.tokenUsage.completion_tokens += response.usage.completion_tokens || 0
				results.tokenUsage.total_tokens += response.usage.total_tokens || 0
			}

			// Handle extracted images if present
			if (response.images && response.images.length > 0 && agentConfig.extract_images?.enabled) {
				console.error('[Image Extraction] Processing ' + response.images.length + ' image(s)...')

				// Scan for next available number once (for sequential naming)
				const naming = agentConfig.extract_images.naming || 'sequential'
				let startNumber

				if (naming === 'sequential') {
					startNumber = await getNextSequentialNumber(
						agentConfig.extract_images.prefix || 'generated-image',
						agentConfig.extract_images.format || 'png'
					)

					// Fallback to timestamp if scan failed
					if (startNumber === null) {
						const timestamp = Date.now()
						startNumber = parseInt(String(timestamp).slice(-6))
						console.error('[Image Naming] Using timestamp-based fallback:', startNumber)
					}
				} else {
					// For turn-based naming, pass turn number
					startNumber = turnCount
				}

				for (let i = 0; i < response.images.length; i++) {
					const image = response.images[i]

					try {
						// Generate filename (now async)
						const filename = await generateImageFilename(
							agentConfig.extract_images.prefix || 'generated-image',
							naming,
							startNumber,
							i,
							agentConfig.extract_images.format || 'png'
						)

						// Check file constraints
						if (!isFileAllowed(filename, agentConfig.file_constraints)) {
							console.error('⚠️  Skipping ' + filename + ' - not allowed by file_constraints')
							continue
						}

						// Decode/download image
						const imageBuffer = await getImageBuffer(image.url)

						// Write to container via write_file tool
						const { callTool } = await import('/workspace/agent/vm-tools/index.mjs')
						await callTool('write_file', {
							path: filename,
							content: imageBuffer.toString('base64'),
							encoding: 'base64'
						}, agentConfig)

						console.error('🖼️  Saved image: ' + filename + ' (' + Math.round(imageBuffer.length / 1024) + ' KB)')
					} catch (error) {
						console.error('✗ Failed to save image ' + i + ': ' + error.message)
					}
				}
			}

			// Log agent thinking to stderr for real-time visibility
			if (response.content && response.content.trim()) {
				console.error(response.content)
			}

				// Add assistant message
				messages.push({
					role: 'assistant',
					content: response.content || '',
					tool_calls: response.rawMessage.tool_calls,
				})

				const turnResult = {
					turn: turnCount,
					timestamp: Date.now(),
					model: agentConfig.model,
					maxTurns: agentConfig.max_turns,
					content: response.content,
					toolCalls: response.toolCalls,
					finishReason: response.finishReason,
					tokenUsage: response.usage,
					toolResults: [],
				}

				// Include inputs on first turn for debugging traces
				// Limit size to prevent JSON serialization issues
				if (turnCount === 1) {
					turnResult.systemPrompt = systemPrompt.length > 50000
						? systemPrompt.substring(0, 50000) + '\n[TRUNCATED]'
						: systemPrompt
					turnResult.userInput = userInput.length > 10000
						? userInput.substring(0, 10000) + '\n[TRUNCATED]'
						: userInput
				}

				// Format tool call for display
			const formatToolCall = (name, args) => {
				switch (name) {
					case 'list_directory':
						return `list_directory('${args.path || '.'}')`
					case 'read_file':
						return `read_file('${args.path}')`
					case 'write_file':
						return `write_file('${args.path}')`
					case 'delete_file':
						return `delete_file('${args.path}')`
					case 'move_file':
						return `move_file('${args.source}' -> '${args.destination}')`
					case 'grep':
						return `grep('${args.pattern}', '${args.path || '.'}')`
					case 'run_node_tests':
						return args.pattern ? `run_node_tests('${args.pattern}')` : 'run_node_tests()'
					default:
						return `${name}(...)`
				}
			}

			// Handle prompt-based tools if enabled
			if (usePromptTools && response.content) {
				const { parseToolCommands, executeToolCommands, formatToolResults } = await import('/workspace/agent/vm-tools/prompt-tool-parser.mjs')
				const commands = parseToolCommands(response.content)

				if (commands.length > 0) {
					console.error('\n[Prompt Tools] Detected ' + commands.length + ' command(s)')

					// Execute commands
					const commandResults = await executeToolCommands(commands, agentConfig)

					// Log commands for visibility
					for (const cmd of commands) {
						console.error('🔧 ' + cmd.name + '(' + JSON.stringify(cmd.args).substring(0, 50) + '...)')
					}

					// Store in turn result (format like native tool calls)
					turnResult.toolCalls = commands.map(cmd => ({
						name: cmd.name,
						arguments: cmd.args,
						mode: 'prompt'
					}))

					turnResult.toolResults = commandResults.map(r => ({
						tool: r.command,
						success: r.success,
						result: r.success ? r.result : undefined,
						error: r.success ? undefined : r.error
					}))

					// Add results as user message
					messages.push({
						role: 'user',
						content: formatToolResults(commandResults)
					})

					// Continue to next turn to process results
					results.turns.push(turnResult)
					continue
				}
			}

			// Execute tool calls if present (native tool calling)
				if (response.toolCalls && response.toolCalls.length > 0) {
					for (let i = 0; i < response.toolCalls.length; i++) {
						const toolCall = response.toolCalls[i]
						try {
							// Log tool call start to stderr
							console.error('\n🔧 ' + formatToolCall(toolCall.name, toolCall.arguments))

						// Call tool directly (no HTTP - runs in VM!)
						// Pass agentConfig for file_constraints enforcement
						const result = await callTool(toolCall.name, toolCall.arguments, agentConfig)

						// Log tool success to stderr
						console.error('✓ ' + toolCall.name + ' completed')

						// For test execution, log the colored output (stderr has colors for humans)
						if (toolCall.name === 'run_node_tests' && result.stderr) {
							console.error('\n--- Test Output ---')
							console.error(result.stderr)
							console.error('---\n')
						}

							turnResult.toolResults.push({
								tool: toolCall.name,
								success: true,
								result,
							})

							// IMPORTANT: Add tool result to the toolCall itself for traces
							if (turnResult.toolCalls[i]) {
								turnResult.toolCalls[i].result = result
							}

							// Add tool result to messages
							messages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify(result),
							})
						} catch (error) {
							// Log tool failure to stderr
							console.error('✗ ' + toolCall.name + ' failed: ' + error.message)

							turnResult.toolResults.push({
								tool: toolCall.name,
								success: false,
								error: error.message,
							})

							// IMPORTANT: Add tool error to the toolCall itself for traces
							if (turnResult.toolCalls[i]) {
								turnResult.toolCalls[i].result = { error: error.message }
							}

							// CRITICAL: Still add tool message even on error
							// OpenAI requires a response for every tool_call_id
							messages.push({
								role: 'tool',
								tool_call_id: toolCall.id,
								content: JSON.stringify({ error: error.message }),
							})
						}
					}
				}

			results.turns.push(turnResult)

			// Log token usage and cost to stderr after each turn
			if (response.usage && response.usage.total_tokens) {
				const promptTokens = response.usage.prompt_tokens || 0
				const completionTokens = response.usage.completion_tokens || 0
				const totalTokens = response.usage.total_tokens

				// Calculate cost
				const costData = getCost(agentConfig.model, promptTokens, completionTokens, pricingOverrides)
				const contextPct = getContextPercent(promptTokens, agentConfig.model, pricingOverrides)

				// Store cost in turn result
				turnResult.cost = costData.total_cost
				turnResult.contextPercent = contextPct

				// Log to stderr for real-time display
				console.error('📊 Tokens: ' + totalTokens + ' (' + promptTokens + '→' + completionTokens + ')')
				console.error('💰 Cost: $' + costData.total_cost.toFixed(4) + ' | Context: ' + contextPct.toFixed(1) + '%\n')
			}

			// Write trace file directly (bypasses stdout JSON limits)
			writeTrace(agentConfig.name, __FLOW_RUN_COUNT__, turnCount, {
				...turnResult,
				systemPrompt: turnCount === 1 ? systemPrompt : undefined,
				userInput: turnCount === 1 ? userInput : undefined,
			})

			// Check if done
				if (response.finishReason === 'stop' || response.finishReason === 'end_turn') {
					results.success = true
					results.finalMessage = response.content
					break
				}

				if (!response.toolCalls || response.toolCalls.length === 0) {
					results.success = true
					results.finalMessage = response.content
					break
				}
			} catch (error) {
				results.error = error.message
				break
			}
		}

		// Slim down results for stdout (traces already written to disk)
		// Remove large fields to avoid JSON serialization issues
		delete results.messages
		results.turns = results.turns.map(t => ({
			turn: t.turn,
			tokenUsage: t.tokenUsage,
			cost: t.cost,
			contextPercent: t.contextPercent,
			finishReason: t.finishReason,
		}))

		// Output result as JSON to stdout
		const jsonOutput = JSON.stringify(results)
		writeFileSync(1, jsonOutput + '\n')
	} catch (error) {
		// If any error occurs during script execution, output error as JSON
		const errorOutput = JSON.stringify({
			success: false,
			error: error.message,
			stack: error.stack,
			turns: [],
			finalMessage: null,
			messages: [],
			tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
		})
		writeFileSync(1, errorOutput + '\n')
	}
}

// Run main and ensure it completes
main().catch(error => {
	console.error('Fatal error:', error)
	process.exit(1)
})
