/**
 * Prompt-Based Tool Instructions
 * Loads and injects tool usage instructions from TOOLS.md template
 */

import fs from 'fs/promises'

/**
 * Load and inject tool instructions from template
 * Filters to only show tools the agent has access to
 * 
 * @param {string} systemPrompt - Current system prompt
 * @param {Array} toolDefinitions - Available tool definitions
 * @param {string} promptsDir - Path to prompts directory
 * @returns {Promise<string>} Updated system prompt with tool instructions
 */
export async function injectToolInstructions(systemPrompt, toolDefinitions, promptsDir) {
	if (toolDefinitions.length === 0) {
		return systemPrompt
	}
	
	// Load TOOLS.md template
	const toolsPath = `${promptsDir}/common/TOOLS.md`
	let toolsTemplate
	
	try {
		toolsTemplate = await fs.readFile(toolsPath, 'utf-8')
	} catch (error) {
		// Fallback: generate basic instructions if template missing
		console.error('[Tool Instructions] TOOLS.md not found, using fallback')
		return systemPrompt + generateBasicToolInstructions(toolDefinitions)
	}
	
	// Filter template to only show available tools
	const availableToolNames = new Set(toolDefinitions.map(t => t.name.toUpperCase()))
	const filteredTemplate = filterToolTemplate(toolsTemplate, availableToolNames)
	
	return systemPrompt + '\n\n' + filteredTemplate
}

/**
 * Filter tool template to only show available tools
 * Removes sections for tools the agent doesn't have access to
 * 
 * @param {string} template - Full TOOLS.md content
 * @param {Set} availableTools - Set of available tool names (UPPERCASE)
 * @returns {string} Filtered template
 */
function filterToolTemplate(template, availableTools) {
	// Split template into sections
	const lines = template.split('\n')
	const filteredLines = []
	let inToolSection = false
	let currentToolName = null
	let keepSection = false
	
	for (const line of lines) {
		// Check if this is a tool header (starts with **)
		const toolHeaderMatch = line.match(/^\*\*([A-Z_]+)\*\*/)
		
		if (toolHeaderMatch) {
			// Start of a new tool section
			currentToolName = toolHeaderMatch[1]
			keepSection = availableTools.has(currentToolName)
			inToolSection = true
		}
		
		// Check if we're leaving a tool section (empty line or new section)
		if (inToolSection && (line.trim() === '' || line.startsWith('###') || line.startsWith('##'))) {
			inToolSection = false
			currentToolName = null
		}
		
		// Keep line if:
		// - Not in a tool section (headers, notes, etc.)
		// - In a tool section we want to keep
		if (!inToolSection || keepSection) {
			filteredLines.push(line)
		}
	}
	
	return filteredLines.join('\n')
}

/**
 * Generate basic tool instructions if template file is missing
 * Fallback for when TOOLS.md doesn't exist
 * 
 * @param {Array} toolDefinitions - Available tool definitions
 * @returns {string} Basic tool instructions
 */
function generateBasicToolInstructions(toolDefinitions) {
	let instructions = '\n\n## Tool Usage Instructions\n\n'
	instructions += 'You don\'t have direct function calling. Instead, use structured commands in triple-backtick blocks:\n\n'
	instructions += '### Command Format\n\n'
	instructions += '```TOOL_NAME\n'
	instructions += 'arg1: value1\n'
	instructions += 'arg2: value2\n'
	instructions += '```\n\n'
	instructions += '### Available Tools\n\n'
	
	for (const tool of toolDefinitions) {
		instructions += `**${tool.name.toUpperCase()}** - ${tool.description}\n\n`
		
		// Show parameters
		if (tool.inputSchema && tool.inputSchema.properties) {
			const props = tool.inputSchema.properties
			for (const [key, value] of Object.entries(props)) {
				instructions += `- \`${key}\`: ${value.description || 'No description'}\n`
			}
			instructions += '\n'
		}
	}
	
	instructions += '### Important Notes\n'
	instructions += '- Commands are executed automatically\n'
	instructions += '- Results will be provided in my next message\n'
	instructions += '- You can use multiple commands in one response\n'
	instructions += '- All paths are relative to the project root\n'
	
	return instructions
}

