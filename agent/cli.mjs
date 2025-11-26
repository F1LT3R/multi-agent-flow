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
	.name('agent-flow')
	.description('Multi-Agent Flow - AI agent orchestration system')
	.version('0.1.0')

/**
 * Init command - Initialize project
 */
program
	.command('init')
	.description('Initialize agent-flow in current directory')
	.action(async () => {
		console.log(chalk.blue.bold('🚀 Initializing Multi-Agent Flow...\n'))

		try {
			const projectRoot = process.cwd()

			// Create directory structure
			const spinner = ora('Creating directory structure...').start()
			const dirs = ['project', 'tests', 'tests/artifacts', 'plans', 'prompts']

			for (const dir of dirs) {
				await fs.mkdir(path.join(projectRoot, dir), { recursive: true })
			}

			spinner.succeed('Directory structure created')

			// Create config file
			spinner.start('Creating config file...')
			
			try {
				await ConfigLoader.createDefaultConfig(projectRoot)
				spinner.succeed('Config file created: agent-flow.config.mjs')
			} catch (error) {
				if (error.message.includes('already exists')) {
					spinner.info('Config file already exists')
				} else {
					throw error
				}
			}

			// Copy prompt files if they don't exist
			spinner.start('Setting up prompt files...')
			
			const promptFiles = [
				'WRITE_USER_STORIES.md',
				'GENERATE_CODE.md',
				'PLAN_TESTS.md',
				'GENERATE_TESTS.md',
				'REVIEW.md',
				'CLEAN_AND_REFACTOR.md',
				'REPORT.md',
			]

			// Check if prompts already exist in workspace
			const sourcePromptsDir = path.join(projectRoot, 'prompts')
			let promptsExist = false

			try {
				const existingPrompts = await fs.readdir(sourcePromptsDir)
				promptsExist = existingPrompts.length > 0
			} catch (error) {
				// Directory doesn't exist or is empty
			}

			if (promptsExist) {
				spinner.info('Prompt files already exist')
			} else {
				spinner.warn('Prompt files need to be created manually in ./prompts/')
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
			console.log('  2. Review agent-flow.config.mjs')
			console.log('  3. Run: agent-flow run "your feature description"\n')
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
	.action(async (description, options) => {
		console.log(chalk.blue.bold('🤖 Starting Multi-Agent Flow\n'))

		const mcpServers = []
		
		try {
			// Load configuration
			const configLoader = new ConfigLoader()
			await configLoader.load()
			const config = configLoader.getConfig()

			// Start MCP servers
			console.log(chalk.cyan('Starting MCP servers...'))
			
			const fileOpsServer = new FileOpsServer(3100, config.paths.project)
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

			// Run the flow
			const runner = new FlowRunner(config, options.sequence)
			const result = await runner.run(description)

			// Ratchet tests if successful
			if (result.success) {
				console.log(chalk.cyan('\nRatcheting tests to permanent storage...'))
				const ratchet = new Ratchet(config)
				await ratchet.ratchet()
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
			const checkpointManager = new CheckpointManager('./.agent-flow/checkpoints')
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
			
			const fileOpsServer = new FileOpsServer(3100, config.paths.project)
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
			
			const fileOpsServer = new FileOpsServer(3100, config.paths.project)
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
			const checkpointManager = new CheckpointManager('./.agent-flow/checkpoints')
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

// Parse arguments
program.parse()

