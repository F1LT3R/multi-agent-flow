#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import { ConfigLoader } from './core/config-loader.mjs'
import { FlowRunner } from './core/flow-runner.mjs'
import { CheckpointManager } from './core/checkpoint-manager.mjs'
// AgentExecutor, MCPClient, Ratchet, and HTTP MCP servers removed
// Tools now run directly inside Docker VM for security

// Load environment variables
dotenv.config()

const program = new Command()

program
	.name('flow')
	.description('Multi-Agent Flow - AI agent orchestration system')
	.version('0.1.0')

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

		const promptFiles = [
			'WRITE_USER_STORIES.md',
			'GENERATE_CODE.md',
			'PLAN_TESTS.md',
			'GENERATE_TESTS.md',
			'REVIEW.md',
			'CLEAN_AND_REFACTOR.md',
			'REPORT.md',
		]

		// Common templates (shared across all agents)
		const commonFiles = [
			'SHARED.md',
		]

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

			// Copy each template file
			let copiedCount = 0
			let skippedCount = 0
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
			for (const file of commonFiles) {
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

			if (copiedCount === promptFiles.length + commonFiles.length) {
				spinner.succeed('Prompt templates copied (including common/)')
			} else if (copiedCount > 0) {
				spinner.succeed(`Copied ${copiedCount} new prompt templates`)
			} else if (skippedCount > 0) {
				spinner.info('Prompt templates already exist')
			} else {
				spinner.info('No templates to copy (create prompts manually)')
			}
		} catch {
			// Templates directory doesn't exist - that's fine, continue
			spinner.info('No bundled templates found (create prompts manually)')
		}

			// Create .env file if it doesn't exist
			spinner.start('Setting up environment...')

			const envPath = path.join(projectRoot, '.env')
			try {
				await fs.access(envPath)
				spinner.info('.env file already exists')
			} catch {
				spinner.warn('.env file not found. Copy .env.example and add your API keys.')
			}

		console.log(chalk.green.bold('\n✅ Initialization complete!\n'))
		console.log(chalk.yellow('Next steps:'))
		console.log('  1. Add your OpenAI API key to .env')
		console.log('  2. Ensure Docker is running (for agent isolation)')
		console.log('  3. Review .flow/flow.config.mjs')
		console.log('  4. Customize prompts in .flow/prompts/ (optional)')
		console.log('  5. Run: flow run "your feature description"\n')
		} catch (error) {
			console.error(chalk.red('❌ Initialization failed:'), error.message)
			process.exit(1)
		}
	})

/**
 * Run command - Execute full agent flow
 */
program
	.command('run')
	.description('Run the full agent flow')
	.argument('<description>', 'Feature description')
	.option('-f, --flow <name>', 'Flow to run', 'development')
	.option('-s, --sequence <name>', '[Deprecated] Use --flow instead')
	.option('-y, --yes', 'Auto-approve all prompts (non-interactive mode)')
	.option('--auto-approve', 'Alias for --yes')
	.action(async (description, options) => {
		// Set non-interactive mode
		if (options.yes || options.autoApprove) {
			process.env.AUTO_APPROVE = 'true'
		}

		console.log(chalk.blue.bold('🤖 Starting Multi-Agent Flow\n'))

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

			// Tools run directly inside Docker VM - no HTTP servers needed!
			console.log(chalk.cyan('Tools will run inside Docker VM...\n'))

			// Run the flow
			// Support both --flow and deprecated --sequence
		const flowName = options.flow || options.sequence || 'development'
		const runner = new FlowRunner(config, flowName)
			const result = await runner.run(description)

		// Display summary
		console.log(chalk.blue.bold('\n' + '='.repeat(60)))
		console.log(chalk.blue.bold('Flow Summary'))
		console.log(chalk.blue.bold('='.repeat(60)))
		console.log(`Status: ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`)
		console.log(`Flow Runs: ${result.flowRunCount}`)
		console.log(`Agents Executed: ${result.results.length}`)

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

		console.log(`Total Turns: ${totalTurns}`)
		console.log()

		// Model breakdown
		if (Object.keys(modelStats).length > 0) {
			console.log(chalk.cyan('By Model:'))
			for (const [model, stats] of Object.entries(modelStats)) {
				const modelTotalCost = stats.inputCost + stats.outputCost
				console.log(chalk.gray(`  ${model} (${stats.agents} agent${stats.agents > 1 ? 's' : ''}):`))
				console.log(chalk.gray(`    Tokens: ${stats.promptTokens.toLocaleString()} in + ${stats.completionTokens.toLocaleString()} out = ${stats.totalTokens.toLocaleString()} total`))
				console.log(chalk.gray(`    Cost: $${stats.inputCost.toFixed(4)} in + $${stats.outputCost.toFixed(4)} out = $${modelTotalCost.toFixed(4)} total`))
				console.log()
			}
		}

		console.log(chalk.bold(`Total: ${totalTokens.toLocaleString()} tokens, $${totalCost.toFixed(4)}`))
		console.log(`Average per Agent: $${(totalCost / result.results.length).toFixed(4)}`)

		if (!result.success) {
			console.log()
			console.log(`Failure Reason: ${result.reason}`)
		}

		console.log(chalk.blue.bold('='.repeat(60) + '\n'))

		} catch (error) {
			console.error(chalk.red('\n❌ Flow failed:'), error.message)
			console.error(error.stack)
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
			const runner = new FlowRunner(config, state.flowName || state.sequenceName || 'development')
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
			const runner = new FlowRunner(config, 'development')

			// For single agent mode, we run just this one agent
			console.log(chalk.yellow('Single agent mode - using flow runner for Docker execution'))
			console.log(chalk.gray('For full debugging, use: flow run "description"\n'))

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

// Parse arguments
program.parse()

