#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs/promises'
import path from 'path'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import { ConfigLoader } from './core/config-loader.mjs'
import { FlowRunner } from './core/flow-runner.mjs'
import { CheckpointManager } from './core/checkpoint-manager.mjs'
import { DockerManager } from './core/docker-manager.mjs'
// AgentExecutor, MCPClient, Ratchet, and HTTP MCP servers removed
// Tools now run directly inside Docker VM for security

const program = new Command()

program
	.name('flow')
	.description('Multi-Agent Flow - AI agent orchestration system')
	.version('0.1.0')

/**
 * Prompt user to clear working context after successful flow
 * Auto-clears in non-interactive mode
 */
async function promptClearContext() {
	const contextDir = path.join(process.cwd(), '.flow/context')

	// Check if context exists
	try {
		await fs.access(contextDir)
	} catch {
		return // No context to clear
	}

	// Auto-clear in non-interactive mode
	if (process.env.AUTO_APPROVE === 'true') {
		await fs.rm(contextDir, { recursive: true, force: true })
		console.log(chalk.green('✓ Context cleared (auto-approve mode)'))
		return
	}

	// Prompt user
	const readline = await import('readline')
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question(
			'Clear working context? (y/n): ',
			async (answer) => {
				rl.close()
				if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
					await fs.rm(contextDir, { recursive: true, force: true })
					console.log(chalk.green('✓ Context cleared'))
				} else {
					console.log(chalk.gray('Context preserved in .flow/context/'))
				}
				resolve()
			}
		)
	})
}

/**
 * Execute a flow by name
 * Shared implementation for all dynamic flow commands
 */
async function runFlow(flowName, description, options) {
	// Set non-interactive mode
	if (options.yes || options.autoApprove) {
		process.env.AUTO_APPROVE = 'true'
	}

	// Clear context if requested
	if (options.clearContext) {
		const contextDir = path.join(process.cwd(), '.flow/context')
		try {
			await fs.rm(contextDir, { recursive: true, force: true })
			console.log(chalk.cyan('Context cleared. Starting fresh.\n'))
		} catch {
			// Directory may not exist, that's fine
		}
	}

	console.log(chalk.blue.bold(`🤖 Starting Multi-Agent Flow: ${flowName}\n`))

	try {
		// Check Docker - REQUIRED for safety
		const spinner = ora('Checking Docker...').start()
		try {
			const { exec } = await import('child_process')
			const { promisify } = await import('util')
			const execAsync = promisify(exec)
			await execAsync('docker info')
			spinner.succeed('Docker is running')
		} catch (error) {
			spinner.fail('Docker is not available')
			console.error(chalk.red('\n❌ ERROR: Docker is required for safe agent execution\n'))
			console.error(chalk.yellow('Why Docker is required:'))
			console.error(chalk.gray('  - Agents run arbitrary code and can modify your system'))
			console.error(chalk.gray('  - Docker isolation prevents system damage'))
			console.error(chalk.gray('  - Running without Docker can brick your computer\n'))
			console.error(chalk.cyan('To fix this:'))
			console.error(chalk.gray('  1. Install Docker Desktop: https://www.docker.com/products/docker-desktop'))
			console.error(chalk.gray('  2. Start Docker'))
			console.error(chalk.gray('  3. Run this command again\n'))
			process.exit(1)
		}

		// Load configuration
		const configLoader = new ConfigLoader()
		await configLoader.load()
		const config = configLoader.getConfig()

		// Validate flow exists
		if (!config.flows || !config.flows[flowName]) {
			const available = Object.keys(config.flows || {}).join(', ')
			console.error(chalk.red(`\n❌ Unknown flow '${flowName}'. Available: ${available}\n`))
			process.exit(1)
		}

		// Tools run directly inside Docker VM - no HTTP servers needed!
		console.log(chalk.cyan('Tools will run inside Docker VM...\n'))

		// Run the flow
		const runner = new FlowRunner(config, flowName, {
			noHud: options.noHud || false,
			hudSpeed: options.hudSpeed || 'medium'
		})
		const result = await runner.run(description)

		// Calculate detailed metrics by model
		const { getCost } = await import('./data/model-pricing.mjs')
		const pricingOverrides = config.pricing?.overrides || {}
		const modelStats = {}
		let totalTurns = 0
		let totalPromptTokens = 0
		let totalCompletionTokens = 0
		let totalTokens = 0
		let totalInputCost = 0
		let totalOutputCost = 0

		for (const agentResult of result.results) {
			if (agentResult.tokenUsage) {
				const model = agentResult.model || 'unknown'
				const promptTokens = agentResult.tokenUsage.prompt_tokens || 0
				const completionTokens = agentResult.tokenUsage.completion_tokens || 0
				const tokens = agentResult.tokenUsage.total_tokens || 0
				const turns = agentResult.turns?.length || 0

				// Calculate cost
				const costData = getCost(model, promptTokens, completionTokens, pricingOverrides)

				// Aggregate totals
				totalTurns += turns
				totalPromptTokens += promptTokens
				totalCompletionTokens += completionTokens
				totalTokens += tokens
				totalInputCost += costData.input_cost
				totalOutputCost += costData.output_cost

				// Aggregate by model
				if (!modelStats[model]) {
					modelStats[model] = {
						agents: 0,
						turns: 0,
						promptTokens: 0,
						completionTokens: 0,
						totalTokens: 0,
						inputCost: 0,
						outputCost: 0,
					}
				}
				modelStats[model].agents++
				modelStats[model].turns += turns
				modelStats[model].promptTokens += promptTokens
				modelStats[model].completionTokens += completionTokens
				modelStats[model].totalTokens += tokens
				modelStats[model].inputCost += costData.input_cost
				modelStats[model].outputCost += costData.output_cost
			}
		}

		const totalCost = totalInputCost + totalOutputCost

		// Helper to strip ANSI codes for width calculation
		const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '')

		// Helper to calculate visual width (emojis count as 2)
		const visualWidth = (str) => {
			const plain = stripAnsi(str)
			let width = 0
			for (const char of plain) {
				// Emoji and wide characters take 2 spaces
				const code = char.codePointAt(0)
				if (code > 0x1F000 || (code >= 0x2600 && code <= 0x27BF)) {
					width += 2
				} else {
					width += 1
				}
			}
			return width
		}

		// Build all summary lines
		const boxWidth = 58
		const lines = []

		lines.push(chalk.white.bold('  📊 Flow Summary'))
		lines.push('')
		lines.push(`  ${result.success ? '✅' : '❌'} Status: ${result.success ? chalk.green.bold('SUCCESS') : chalk.red.bold('FAILED')}`)
		lines.push(`  🔄 Flow Runs: ${chalk.white.bold(result.flowRunCount)}`)
		lines.push(`  🤖 Agents Executed: ${chalk.white.bold(result.results.length)}`)
		lines.push(`  💬 Total Turns: ${chalk.white.bold(totalTurns)}`)

		// Model breakdown
		if (Object.keys(modelStats).length > 0) {
			lines.push('')
			lines.push(chalk.yellow.bold('  📈 By Model:'))
			for (const [model, stats] of Object.entries(modelStats)) {
				const modelTotalCost = stats.inputCost + stats.outputCost
				lines.push(chalk.cyan(`    ◆ ${model}`) + chalk.white(` (${stats.agents} agent${stats.agents > 1 ? 's' : ''})`))
				lines.push(chalk.cyan(`       📥 Tokens: `) + chalk.white(`${stats.promptTokens.toLocaleString()} in + ${stats.completionTokens.toLocaleString()} out`))
				lines.push(chalk.cyan(`       💰 Cost: `) + chalk.green(`$${modelTotalCost.toFixed(4)}`))
				lines.push('')
			}
		}

		lines.push(chalk.cyan('  ' + '─'.repeat(40)))
		lines.push(`  📊 ${chalk.white.bold('Total:')} ${chalk.cyan.bold(totalTokens.toLocaleString())} tokens, ${chalk.green.bold('$' + totalCost.toFixed(4))}`)
		lines.push(`  📉 ${chalk.white('Average per Agent:')} ${chalk.green('$' + (totalCost / result.results.length).toFixed(4))}`)

		if (!result.success) {
			lines.push('')
			lines.push(chalk.red(`  ⚠️  Failure Reason: ${result.reason}`))
		}

		// Display summary in a single box
		console.log(chalk.cyan.bold('\n╔' + '═'.repeat(boxWidth) + '╗'))
		for (const line of lines) {
			const padding = boxWidth - visualWidth(line)
			console.log(chalk.cyan.bold('║') + line + ' '.repeat(Math.max(0, padding)) + chalk.cyan.bold('║'))
		}
		console.log(chalk.cyan.bold('╚' + '═'.repeat(boxWidth) + '╝\n'))

		// Prompt to clear context after successful run
		if (result.success) {
			await promptClearContext()
		}

	} catch (error) {
		console.error(chalk.red('\n❌ Flow failed:'), error.message)
		console.error(error.stack)
		process.exit(1)
	}
}

/**
 * Build the colorized "Flows:" help section
 */
function buildFlowsHelpSection(flows) {
	const lines = []

	lines.push('')
	lines.push(chalk.magenta.bold('Flows:'))

	// Calculate column widths for alignment
	let maxNameWidth = 0
	for (const [flowName, flowConfig] of Object.entries(flows || {})) {
		const aliases = flowConfig.aliases || []
		const nameWithAliases = aliases.length > 0
			? `${flowName}`
			: flowName
		maxNameWidth = Math.max(maxNameWidth, nameWithAliases.length)
	}

	// Pad to at least 20 chars for visual consistency
	maxNameWidth = Math.max(maxNameWidth, 12)

	for (const [flowName, flowConfig] of Object.entries(flows || {})) {
		const aliases = flowConfig.aliases || []
		const description = flowConfig.description || `Run the ${flowName} flow`

		// Build the line with colors
		let namePart = chalk.cyan.bold(flowName)
		if (aliases.length > 0) {
			namePart += chalk.gray(' | ') + chalk.yellow(aliases.join(chalk.gray(', ')))
		}

		// Calculate padding (accounting for color codes)
		const plainName = aliases.length > 0
			? `${flowName} | ${aliases.join(', ')}`
			: flowName
		const padding = ' '.repeat(Math.max(2, maxNameWidth + 8 - plainName.length))

		lines.push(`  ${namePart}${padding}${chalk.white(description)}`)
	}

	lines.push('')
	lines.push(chalk.gray('  Run a flow: ') + chalk.white('flow <flow-name> "<description>"'))
	lines.push(chalk.gray('  Example:    ') + chalk.cyan('flow dev "Add user authentication"'))
	lines.push('')

	return lines.join('\n')
}

// Track which commands are flow commands (to hide from Commands section)
const flowCommandNames = new Set()

/**
 * Dynamically register CLI commands for each flow in config
 */
async function registerFlowCommands() {
	let config

	try {
		const configLoader = new ConfigLoader()
		await configLoader.load()
		config = configLoader.getConfig()
	} catch {
		// Fallback for uninitialized projects - show default commands
		config = {
			flows: {
				development: {
					description: 'Develop features with tests.',
					aliases: ['dev'],
				},
				testing: {
					description: 'Write and fix tests only (no new code).',
					aliases: ['test'],
				},
			},
		}
	}

	// Track flow command names for help filtering
	for (const flowName of Object.keys(config.flows || {})) {
		flowCommandNames.add(flowName)
	}

	// Configure help to filter out flow commands from Commands section
	program.configureHelp({
		visibleCommands: (cmd) => {
			return cmd.commands.filter(c => !flowCommandNames.has(c.name()))
		}
	})

	// Add custom "Flows:" section to help output
	program.addHelpText('after', buildFlowsHelpSection(config.flows))

	// Register each flow as a command
	for (const [flowName, flowConfig] of Object.entries(config.flows || {})) {
		const cmd = program
			.command(flowName)
			.description(flowConfig.description || `Run the ${flowName} flow`)
			.argument('<description>', 'What to build or fix')
			.option('-y, --yes', 'Auto-approve all prompts (non-interactive)')
			.option('--auto-approve', 'Alias for --yes')
			.option('--clear-context', 'Clear working context before starting (fresh run)')
			.option('--no-hud', 'Disable realtime HUD display')
			.option('--hud-speed <speed>', 'Stream animation speed (slow|medium|fast|veryfast)', 'medium')
			.action(async (description, options) => {
				await runFlow(flowName, description, options)
			})

		// Register aliases (e.g., 'dev' for 'development')
		if (flowConfig.aliases && Array.isArray(flowConfig.aliases)) {
			for (const alias of flowConfig.aliases) {
				cmd.alias(alias)
			}
		}
	}
}

/**
 * Init command - Initialize project
 */
program
	.command('init')
	.description('Initialize flow in current directory')
	.action(async () => {
		console.log(chalk.blue.bold('🚀 Initializing Multi-Agent Flow...\n'))

		try {
			const projectRoot = process.cwd()

			// Create directory structure
			const spinner = ora('Creating directory structure...').start()
			const dirs = [
				'.flow',                      // Hidden orchestrator state
				'.flow/prompts',              // Agent prompts (moved from root)
				'.flow/checkpoints',          // Resume state (operational)
				'.flow/snapshots',            // Snapshot versioning
				'.flow/traces',               // Execution logs (disposable)
				'.flow/ratchet',              // Ratcheted artifacts
				'.flow/ratchet/stories',      // User stories
				'.flow/ratchet/reports',      // Reports (split from stories)
				'.flow/ratchet/tests',        // Test files (mirrors project structure)
			]

			for (const dir of dirs) {
				await fs.mkdir(path.join(projectRoot, dir), { recursive: true })
			}

			spinner.succeed('Directory structure created')

			// Create config file
			spinner.start('Creating config file...')

			try {
				await ConfigLoader.createDefaultConfig(projectRoot)
				spinner.succeed('Config file created: .flow/flow.config.mjs')
			} catch (error) {
				if (error.message.includes('already exists')) {
					spinner.info('Config file already exists')
				} else {
					throw error
				}
			}

		// Copy template files to .flow/prompts directory
		spinner.start('Copying prompt templates...')

		// Determine template source directory
		// If running from repo, use ./templates
		// If installed globally, templates are in the package
		const packageRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
		const templatesDir = path.join(packageRoot, 'templates')
		const userPromptsDir = path.join(projectRoot, '.flow/prompts')
		const userCommonDir = path.join(userPromptsDir, 'common')

		try {
			// Check if templates directory exists
			await fs.access(templatesDir)

			// Ensure common directory exists
			await fs.mkdir(userCommonDir, { recursive: true })

			// Copy ALL .md files from templates directory (dynamic discovery)
			let copiedCount = 0
			let skippedCount = 0

			const allFiles = await fs.readdir(templatesDir)
			const promptFiles = allFiles.filter(f => f.endsWith('.md'))

			for (const file of promptFiles) {
				const sourcePath = path.join(templatesDir, file)
				const destPath = path.join(userPromptsDir, file)

				try {
					// Check if destination already exists
					await fs.access(destPath)
					skippedCount++ // File exists, skip
				} catch {
					// File doesn't exist, try to copy it
					try {
						await fs.copyFile(sourcePath, destPath)
						copiedCount++
					} catch {
						// Source doesn't exist, skip silently
					}
				}
			}

			// Copy common template files
			try {
				const commonFiles = await fs.readdir(path.join(templatesDir, 'common'))
				for (const file of commonFiles.filter(f => f.endsWith('.md'))) {
					const sourcePath = path.join(templatesDir, 'common', file)
					const destPath = path.join(userCommonDir, file)

					try {
						// Check if destination already exists
						await fs.access(destPath)
						// File exists, skip
					} catch {
						// File doesn't exist, try to copy it
						try {
							await fs.copyFile(sourcePath, destPath)
							copiedCount++
						} catch {
							// Source doesn't exist, skip silently
						}
					}
				}
			} catch {
				// common/ directory might not exist, that's fine
			}

			if (copiedCount > 0) {
				spinner.succeed(`Copied ${copiedCount} prompt template(s)`)
			} else if (skippedCount > 0) {
				spinner.info('Prompt templates already exist')
			} else {
				spinner.info('No new templates to copy')
			}
		} catch {
			// Templates directory doesn't exist - that's fine, continue
			spinner.info('No bundled templates found (create prompts manually)')
		}

		console.log(chalk.green.bold('\n✅ Initialization complete!\n'))
		console.log(chalk.yellow('Next steps:'))
		console.log('  1. Set your API key (export or add to shell rc):')
		console.log('')
		console.log('     export OPENAI_API_KEY=sk-...')
		console.log('     export ANTHROPIC_API_KEY=sk-ant-...')
		console.log('     export GOOGLE_AI_API_KEY=...')
		console.log('     export XAI_API_KEY=...')
		console.log('     export DEEPSEEK_API_KEY=...')
		console.log('')
		console.log('  2. Ensure Docker is running (for agent isolation)')
		console.log('  3. Review .flow/flow.config.mjs')
		console.log('  4. Customize prompts in .flow/prompts/ (optional)')
		console.log('  5. Run: flow dev "your feature description"\n')
		} catch (error) {
			console.error(chalk.red('❌ Initialization failed:'), error.message)
			process.exit(1)
		}
	})

/**
 * Resume command - Resume from checkpoint
 */
program
	.command('resume')
	.description('Resume a flow from checkpoint')
	.argument('[run-id]', 'Run ID to resume (uses latest if not specified)')
	.action(async (runId) => {
		console.log(chalk.blue.bold('🔄 Resuming Flow\n'))

		try {
			// Load configuration
			const configLoader = new ConfigLoader()
			await configLoader.load()
			const config = configLoader.getConfig()

			// Get checkpoint
			const checkpointManager = new CheckpointManager('./.flow/checkpoints')
			await checkpointManager.initialize()

			if (!runId) {
				const latest = await checkpointManager.getLatest()
				if (!latest) {
					console.error(chalk.red('No checkpoints found'))
					process.exit(1)
				}
				runId = latest.runId
				console.log(chalk.cyan(`Using latest checkpoint: ${runId}`))
			}

			// Tools run directly inside Docker VM - no HTTP servers needed!
			console.log(chalk.cyan('Tools will run inside Docker VM...\n'))

		// Resume the flow
		const state = await checkpointManager.load(runId)
		const defaultFlow = config.default_flow || 'development'
		const runner = new FlowRunner(config, state.flowName || state.sequenceName || defaultFlow, {
			noHud: false, // Enable HUD by default for resume
			hudSpeed: 'medium'
		})
		const result = await runner.run(state.userInput, runId)

			console.log(chalk.green.bold('\n✅ Flow resumed and completed!'))

		} catch (error) {
			console.error(chalk.red('\n❌ Resume failed:'), error.message)
			process.exit(1)
		}
	})

/**
 * Mode command - Run single agent
 */
program
	.command('mode')
	.description('Run a single agent mode for debugging')
	.argument('<agent-name>', 'Agent name to run')
	.argument('<input>', 'Input for the agent')
	.action(async (agentName, input) => {
		console.log(chalk.blue.bold(`🔧 Running Agent: ${agentName}\n`))
		console.log(chalk.yellow('Note: Single agent mode now runs inside Docker VM\n'))

		try {
			// Load configuration
			const configLoader = new ConfigLoader()
			await configLoader.load()
			const config = configLoader.getConfig()

			const agentConfig = config.agents.find((a) => a.name === agentName)
			if (!agentConfig) {
				console.error(chalk.red(`Agent '${agentName}' not found`))
				process.exit(1)
			}

			// Tools run directly inside Docker VM - no HTTP servers needed!
			console.log(chalk.cyan('Tools will run inside Docker VM...\n'))

			// Run the agent via FlowRunner (which uses DockerAgentExecutor)
			const defaultFlow = config.default_flow || 'development'
			const runner = new FlowRunner(config, defaultFlow)

			// For single agent mode, we run just this one agent
			console.log(chalk.yellow('Single agent mode - using flow runner for Docker execution'))
			console.log(chalk.gray('For full debugging, use: flow dev "description"\n'))

			// Display info
			console.log(chalk.blue.bold('Agent Configuration:'))
			console.log(`  Name: ${agentConfig.name}`)
			console.log(`  Model: ${agentConfig.model}`)
			console.log(`  Max Turns: ${agentConfig.max_turns}`)
			console.log(`  Prompt: ${agentConfig.prompt_file}`)

		} catch (error) {
			console.error(chalk.red('\n❌ Agent execution failed:'), error.message)
			process.exit(1)
		}
	})

/**
 * Prompts command - Display all agent prompts with resolved templates
 */
program
	.command('prompts')
	.description('Display all agent prompts with resolved templates and settings')
	.action(async () => {
		try {
			const { resolveTemplatePlaceholders } = await import('./core/template-resolver.mjs')

			// Load configuration
			const configLoader = new ConfigLoader()
			await configLoader.load()
			const config = configLoader.getConfig()

			// Build markdown string
			let markdown = ''

			for (const agent of config.agents) {
				// Load prompt file
				const promptFile = agent.prompt_file.split('/').pop()
				const promptPath = path.join('.flow/prompts', promptFile)

				let prompt
				try {
					prompt = await fs.readFile(promptPath, 'utf-8')
					// Resolve placeholders (show {{INTENT}} as literal since no actual intent)
					prompt = await resolveTemplatePlaceholders(prompt, '.flow/prompts', '{{INTENT}}')
				} catch (error) {
					prompt = `[Error loading prompt: ${error.message}]`
				}

				// Build markdown for each agent
				markdown += `# ${agent.name}\n\n`

				markdown += `## Settings\n\n`
				markdown += `| Setting | Value |\n`
				markdown += `|---------|-------|\n`
				markdown += `| Model | ${agent.model} |\n`
				markdown += `| Temperature | ${agent.settings?.temperature ?? 'default'} |\n`
				markdown += `| Max Turns | ${agent.max_turns} |\n`
				if (agent.is_gatekeeper) {
					markdown += `| Gatekeeper | Yes |\n`
				}
				markdown += '\n'

				// File constraints
				if (agent.file_constraints) {
					markdown += `## File Constraints\n\n`
					const patterns = agent.file_constraints.write_patterns || []
					const excludes = agent.file_constraints.exclude_patterns || []
					if (patterns.length === 0) {
						markdown += `Read-only (no writes allowed)\n\n`
					} else {
						markdown += `Write patterns: ${patterns.map(p => '`' + p + '`').join(', ')}\n\n`
						if (excludes.length > 0) {
							markdown += `Exclude patterns: ${excludes.map(p => '`' + p + '`').join(', ')}\n\n`
						}
					}
				}

				// Tools
				markdown += `## Tools\n\n`
				const tools = agent.mcp_tools?.include || []
				if (tools.length === 0) {
					markdown += `None\n\n`
				} else {
					tools.forEach(t => markdown += `- ${t}\n`)
					markdown += '\n'
				}

				// Prompt content
				markdown += `## Prompt\n\n`
				markdown += prompt
				markdown += `\n\n---\n\n`
			}

			// Output based on TTY detection
			if (process.stdout.isTTY) {
				marked.setOptions({ renderer: new TerminalRenderer() })
				console.log(marked(markdown))
			} else {
				console.log(markdown)
			}
		} catch (error) {
			console.error(chalk.red('Failed to display prompts:'), error.message)
			process.exit(1)
		}
	})

/**
 * List command - List checkpoints
 */
program
	.command('list')
	.description('List available checkpoints')
	.action(async () => {
		try {
			const checkpointManager = new CheckpointManager('./.flow/checkpoints')
			const checkpoints = await checkpointManager.list()

			if (checkpoints.length === 0) {
				console.log(chalk.yellow('No checkpoints found'))
				return
			}

			console.log(chalk.blue.bold('Available Checkpoints:\n'))

			for (const checkpoint of checkpoints) {
				console.log(`${chalk.cyan(checkpoint.runId)}`)
				console.log(`  Timestamp: ${checkpoint.timestamp.toISOString()}`)
				console.log('')
			}
		} catch (error) {
			console.error(chalk.red('Failed to list checkpoints:'), error.message)
		}
	})

/**
 * Ratchet command - Manage ratcheted artifacts
 */
const ratchetCmd = program
	.command('ratchet')
	.description('Manage ratcheted artifacts')

ratchetCmd
	.command('tests')
	.description('Ratchet changed tests (requires tests to pass)')
	.option('--dry-run', 'Show what would be ratcheted without doing it')
	.option('--force', 'Ratchet even if tests fail, auto-delete orphans')
	.action(async (options) => {
		const { Ratchet } = await import('./core/ratchet.mjs')
		const readline = await import('readline')

		console.log(chalk.blue.bold('🔒 Ratchet Tests\n'))

		try {
			const ratchet = new Ratchet(process.cwd())

			// Step 1: Find changed tests
			const spinner = ora('Finding changed tests...').start()
			const changed = await ratchet.findChangedTests()
			const deleted = await ratchet.findDeletedTests()

			if (changed.length === 0 && deleted.length === 0) {
				spinner.succeed('No test changes to ratchet')
				return
			}

			spinner.succeed(`Found ${changed.length} changed, ${deleted.length} deleted test(s)`)

			// Display what will be ratcheted
			if (changed.length > 0) {
				console.log('')
				for (const { relativePath, isNew } of changed) {
					const tag = isNew ? chalk.green('[new]') : chalk.yellow('[mod]')
					console.log(`  ${tag} ${relativePath}`)
				}
			}

			// Display deleted tests
			if (deleted.length > 0) {
				console.log('')
				for (const { relativePath } of deleted) {
					console.log(`  ${chalk.red('[del]')} ${relativePath}`)
				}
			}
			console.log('')

			// Dry run - stop here
			if (options.dryRun) {
				console.log(chalk.yellow('Dry run - no changes made'))
				return
			}

			// Step 2: Run tests (unless --force) - only if there are tests to run
			if (changed.length > 0 && !options.force) {
				const testSpinner = ora('Running tests...').start()
				const testResult = await ratchet.runTests()

				if (!testResult.success) {
					testSpinner.fail('Tests failed - not ratcheting')
					console.log(chalk.red('\nTest output:'))
					console.log(chalk.gray(testResult.output || testResult.error))
					process.exit(1)
				}

				testSpinner.succeed('Tests passed')
			} else if (changed.length > 0) {
				console.log(chalk.yellow('⚠️  Skipping tests (--force)'))
			}

			// Step 3: Ratchet the changed tests
			let ratchetedCount = 0
			if (changed.length > 0) {
				const ratchetSpinner = ora('Ratcheting tests...').start()
				const operations = await ratchet.ratchetChangedTests(changed)
				ratchetSpinner.succeed(`Ratcheted ${operations.length} test(s)`)
				ratchetedCount = operations.length
			}

			// Step 4: Handle deleted tests
			let deletedCount = 0
			if (deleted.length > 0) {
				const toDelete = []

				if (options.force) {
					// Auto-delete all in force mode
					toDelete.push(...deleted)
				} else {
					// Interactive prompts for each deleted file
					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					})

					const ask = (question) => new Promise((resolve) => rl.question(question, resolve))

					let skipAll = false
					let acceptAll = false

					for (const file of deleted) {
						if (skipAll) break
						if (acceptAll) {
							toDelete.push(file)
							continue
						}

						const answer = await ask(
							`\nRemove ${chalk.cyan(file.relativePath)} from ratchet? [${chalk.green('y')}es/${chalk.red('n')}o/${chalk.green('a')}ll/${chalk.yellow('s')}kip all]: `
						)

						const choice = answer.trim().toLowerCase()
						if (choice === 'y' || choice === 'yes') {
							toDelete.push(file)
						} else if (choice === 'a' || choice === 'all') {
							acceptAll = true
							toDelete.push(file)
						} else if (choice === 's' || choice === 'skip') {
							skipAll = true
						}
						// 'n' or anything else = skip this file
					}

					rl.close()
				}

				if (toDelete.length > 0) {
					deletedCount = await ratchet.deleteRatchetedTests(toDelete)
					console.log(chalk.gray(`\n  Removed ${deletedCount} orphaned test(s) from ratchet`))
				}
			}

			// Summary
			const parts = []
			if (ratchetedCount > 0) parts.push(`${ratchetedCount} ratcheted`)
			if (deletedCount > 0) parts.push(`${deletedCount} removed`)
			console.log(chalk.green.bold(`\n✅ Done. ${parts.join(', ')}.\n`))
		} catch (error) {
			console.error(chalk.red('\n❌ Ratchet failed:'), error.message)
			process.exit(1)
		}
	})

/**
 * Rebuild command - Force rebuild the Docker image
 */
program
	.command('rebuild')
	.description('Force rebuild the Docker image')
	.action(async () => {
		console.log(chalk.blue.bold('🔨 Rebuilding Docker image...\n'))

		try {
			const dockerManager = new DockerManager({})
			await dockerManager.buildImage()
			console.log(chalk.green('\n✓ Docker image rebuilt successfully\n'))
		} catch (error) {
			console.error(chalk.red('Failed to rebuild Docker image:'), error.message)
			process.exit(1)
		}
	})

/**
 * Cleanup command - Kill stuck MCP servers
 */
program
	.command('cleanup')
	.description('Kill any stuck MCP server processes')
	.action(async () => {
		console.log(chalk.blue.bold('🧹 Cleaning up MCP servers\n'))

		try {
			const { exec } = await import('child_process')
			const { promisify } = await import('util')
			const execAsync = promisify(exec)

			// Try to find and kill processes on MCP ports
			try {
				await execAsync('lsof -ti:3100,3101,3102,3103 | xargs kill -9 2>/dev/null')
				console.log(chalk.green('✓ Killed processes on ports 3100-3103'))
			} catch (error) {
				// lsof might not be available or no processes found
				console.log(chalk.yellow('No processes found on MCP ports (3100-3103)'))
			}

			console.log(chalk.green('\n✓ Cleanup complete\n'))
		} catch (error) {
			console.error(chalk.red('Cleanup failed:'), error.message)
			console.log(chalk.yellow('\nTry manually:'))
			console.log(chalk.gray('  lsof -ti:3100,3101,3102,3103 | xargs kill -9'))
			console.log(chalk.gray('  or: pkill -f "mcp-server"\n'))
		}
	})

/**
 * Clear-context command - Clear the working context directory
 */
program
	.command('clear-context')
	.description('Clear the working context directory (.flow/context/)')
	.action(async () => {
		console.log(chalk.blue.bold('🧹 Clearing working context\n'))

		const contextDir = path.join(process.cwd(), '.flow/context')

		try {
			// Check if context directory exists
			await fs.access(contextDir)

			// List files being deleted
			const files = await fs.readdir(contextDir)
			if (files.length === 0) {
				console.log(chalk.yellow('Context directory is already empty'))
				return
			}

			for (const file of files) {
				console.log(chalk.gray(`  Removing: ${file}`))
			}

			// Remove the directory
			await fs.rm(contextDir, { recursive: true, force: true })
			console.log(chalk.green('\n✓ Context cleared\n'))
		} catch (error) {
			if (error.code === 'ENOENT') {
				console.log(chalk.yellow('No context directory found (.flow/context/ does not exist)'))
			} else {
				console.error(chalk.red('Failed to clear context:'), error.message)
				process.exit(1)
			}
		}
	})

/**
 * Main entry point
 * Registers dynamic flow commands before parsing
 */
async function main() {
	await registerFlowCommands()
	program.parse()
}

main().catch((err) => {
	console.error(chalk.red('Fatal error:'), err.message)
	process.exit(1)
})

