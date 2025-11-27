#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import { ConfigLoader } from './core/config-loader.mjs'
import { FlowRunner } from './core/flow-runner.mjs'
import { AgentExecutor } from './core/agent-executor.mjs'
import { MCPClient } from './core/mcp-client.mjs'
import { CheckpointManager } from './core/checkpoint-manager.mjs'
import { Ratchet } from './core/ratchet.mjs'
import { FileOpsServer } from './mcp-servers/file-ops-server.mjs'
import { TestRunnerServer } from './mcp-servers/test-runner-server.mjs'
import { AnalysisServer } from './mcp-servers/analysis-server.mjs'
import { InternetServer } from './mcp-servers/internet-server.mjs'

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
			'stories',                  // User stories and reports
			'prompts',                  // Agent prompts (will be populated)
			'tests',                    // Tests at root level
			'tests/artifacts',          // Test artifacts
			'.flow',                    // Hidden orchestrator state
			'.flow/logs',               // Logs parent
			'.flow/logs/checkpoints',   // Checkpoints (nested)
			'.flow/logs/traces',        // Traces (nested)
			'.flow/snapshots',          // Snapshot versioning
			'.flow/snapshots/previous', // Previous snapshot storage
		]

		for (const dir of dirs) {
			await fs.mkdir(path.join(projectRoot, dir), { recursive: true })
		}

		// Create current symlink pointing to project root
		try {
			await fs.symlink('../../', path.join(projectRoot, '.flow/snapshots/current'), 'dir')
		} catch (error) {
			// Symlink might already exist, ignore
		}

		spinner.succeed('Directory structure created')

			// Create config file
			spinner.start('Creating config file...')

			try {
				await ConfigLoader.createDefaultConfig(projectRoot)
				spinner.succeed('Config file created: flow.config.mjs')
			} catch (error) {
				if (error.message.includes('already exists')) {
					spinner.info('Config file already exists')
				} else {
					throw error
				}
			}

		// Copy template files to user's prompts directory
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

		// Determine template source directory
		// If running from repo, use ./templates
		// If installed globally, templates are in the package
		const packageRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
		const templatesDir = path.join(packageRoot, 'templates')
		const userPromptsDir = path.join(projectRoot, 'prompts')

		try {
			// Check if templates directory exists
			await fs.access(templatesDir)

			// Copy each template file
			let copiedCount = 0
			for (const file of promptFiles) {
				const sourcePath = path.join(templatesDir, file)
				const destPath = path.join(userPromptsDir, file)

				try {
					// Check if destination already exists
					await fs.access(destPath)
					// File exists, skip
				} catch {
					// File doesn't exist, copy it
					await fs.copyFile(sourcePath, destPath)
					copiedCount++
				}
			}

			if (copiedCount === promptFiles.length) {
				spinner.succeed('Prompt templates copied')
			} else if (copiedCount > 0) {
				spinner.succeed(`Copied ${copiedCount} new prompt templates`)
			} else {
				spinner.info('Prompt templates already exist')
			}
		} catch (error) {
			spinner.warn('Could not copy templates. You may need to create prompts manually.')
			console.error('  Error:', error.message)
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
		console.log('  3. Review flow.config.mjs')
		console.log('  4. Customize prompts in ./prompts/ (optional)')
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
	.option('-s, --sequence <name>', 'Sequence to run', 'development')
	.option('-y, --yes', 'Auto-approve all prompts (non-interactive mode)')
	.option('--auto-approve', 'Alias for --yes')
	.action(async (description, options) => {
		// Set non-interactive mode
		if (options.yes || options.autoApprove) {
			process.env.AUTO_APPROVE = 'true'
		}

		console.log(chalk.blue.bold('🤖 Starting Multi-Agent Flow\n'))

		const mcpServers = []

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

	// Start MCP servers
	console.log(chalk.cyan('Starting MCP servers...'))

	try {
		// SECURITY: Root FileOpsServer to workspace root with multi-directory access
		// Agents can write to: stories/, tests/, and root (for code)
		// Agents CANNOT write to: .flow/, flow.config.mjs, prompts/
		const fileOpsServer = new FileOpsServer(3100, process.cwd())
		await fileOpsServer.start()
		mcpServers.push(fileOpsServer)

			const testRunnerServer = new TestRunnerServer(3101, process.cwd())
			await testRunnerServer.start()
			mcpServers.push(testRunnerServer)

			const analysisServer = new AnalysisServer(3102, process.cwd())
			await analysisServer.start()
			mcpServers.push(analysisServer)

				const internetServer = new InternetServer(3103)
				await internetServer.start()
				mcpServers.push(internetServer)

				console.log(chalk.green('✓ MCP servers running\n'))
			} catch (error) {
				if (error.code === 'EADDRINUSE') {
					console.error(chalk.red('\n❌ ERROR: MCP server ports are already in use\n'))
					console.error(chalk.yellow('This usually means a previous run did not shut down cleanly.\n'))
					console.error(chalk.cyan('To fix this, run:'))
					console.error(chalk.gray('  lsof -ti:3100,3101,3102,3103 | xargs kill -9\n'))
					console.error(chalk.gray('Or on some systems:'))
					console.error(chalk.gray('  pkill -f "mcp-server"\n'))
					process.exit(1)
				}
				throw error
			}

			// Run the flow
			const runner = new FlowRunner(config, options.sequence)
			const result = await runner.run(description)

		// Create snapshot if successful
		if (result.success) {
			console.log(chalk.cyan('\nCreating snapshot of successful run...'))
			const { SnapshotManager } = await import('./core/snapshot-manager.mjs')
			const snapshotManager = new SnapshotManager(config.persistence.snapshots)
			await snapshotManager.createSnapshot()
			console.log(chalk.green('✓ Snapshot created'))
		}

			// Display summary
			console.log(chalk.blue.bold('\n' + '='.repeat(60)))
			console.log(chalk.blue.bold('Flow Summary'))
			console.log(chalk.blue.bold('='.repeat(60)))
			console.log(`Status: ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`)
			console.log(`Flow Runs: ${result.flowRunCount}`)
			console.log(`Agents Executed: ${result.results.length}`)

			// Token usage summary
			let totalTokens = 0
			for (const agentResult of result.results) {
				if (agentResult.tokenUsage) {
					totalTokens += agentResult.tokenUsage.total
				}
			}
			console.log(`Total Tokens Used: ${totalTokens.toLocaleString()}`)

			if (!result.success) {
				console.log(`Failure Reason: ${result.reason}`)
			}

			console.log(chalk.blue.bold('='.repeat(60) + '\n'))

		} catch (error) {
			console.error(chalk.red('\n❌ Flow failed:'), error.message)
			console.error(error.stack)
			process.exit(1)
		} finally {
			// Stop MCP servers
			console.log(chalk.cyan('\nStopping MCP servers...'))
			for (const server of mcpServers) {
				await server.stop()
			}
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

		const mcpServers = []

		try {
			// Load configuration
			const configLoader = new ConfigLoader()
			await configLoader.load()
			const config = configLoader.getConfig()

			// Get checkpoint
			const checkpointManager = new CheckpointManager(config.persistence.checkpoints)
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

			// Start MCP servers
			console.log(chalk.cyan('Starting MCP servers...'))

			const fileOpsServer = new FileOpsServer(3100, process.cwd())
			await fileOpsServer.start()
			mcpServers.push(fileOpsServer)

			const testRunnerServer = new TestRunnerServer(3101, config.paths.project)
			await testRunnerServer.start()
			mcpServers.push(testRunnerServer)

			const analysisServer = new AnalysisServer(3102, config.paths.project)
			await analysisServer.start()
			mcpServers.push(analysisServer)

			const internetServer = new InternetServer(3103)
			await internetServer.start()
			mcpServers.push(internetServer)

			console.log(chalk.green('✓ MCP servers running\n'))

			// Resume the flow
			const state = await checkpointManager.load(runId)
			const runner = new FlowRunner(config, state.sequenceName)
			const result = await runner.run(state.userInput, runId)

			console.log(chalk.green.bold('\n✅ Flow resumed and completed!'))

		} catch (error) {
			console.error(chalk.red('\n❌ Resume failed:'), error.message)
			process.exit(1)
		} finally {
			// Stop MCP servers
			console.log(chalk.cyan('\nStopping MCP servers...'))
			for (const server of mcpServers) {
				await server.stop()
			}
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

		const mcpServers = []

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

			// Start MCP servers
			console.log(chalk.cyan('Starting MCP servers...'))

			const fileOpsServer = new FileOpsServer(3100, process.cwd())
			await fileOpsServer.start()
			mcpServers.push(fileOpsServer)

			const testRunnerServer = new TestRunnerServer(3101, config.paths.project)
			await testRunnerServer.start()
			mcpServers.push(testRunnerServer)

			const analysisServer = new AnalysisServer(3102, config.paths.project)
			await analysisServer.start()
			mcpServers.push(analysisServer)

			const internetServer = new InternetServer(3103)
			await internetServer.start()
			mcpServers.push(internetServer)

			console.log(chalk.green('✓ MCP servers running\n'))

			// Run the agent
			const mcpClient = new MCPClient()
			const executor = new AgentExecutor(agentConfig, mcpClient)
			const result = await executor.execute(input)

			// Display result
			console.log(chalk.blue.bold('\n--- Agent Result ---'))
			console.log(`Success: ${result.success}`)
			console.log(`Turns: ${result.turns.length}`)

			if (result.finalMessage) {
				console.log(chalk.cyan('\nFinal Message:'))
				console.log(result.finalMessage)
			}

			if (result.error) {
				console.error(chalk.red('\nError:'), result.error)
			}

		} catch (error) {
			console.error(chalk.red('\n❌ Agent execution failed:'), error.message)
			process.exit(1)
		} finally {
			// Stop MCP servers
			console.log(chalk.cyan('\nStopping MCP servers...'))
			for (const server of mcpServers) {
				await server.stop()
			}
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
			const checkpointManager = new CheckpointManager(config.persistence.checkpoints)
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

