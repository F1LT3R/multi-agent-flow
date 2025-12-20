// Multi-Agent Flow Configuration
// All paths are hardcoded relative to project root:
// - .flow/prompts/       - Agent prompt files
// - .flow/checkpoints/   - Resume state
// - .flow/snapshots/     - Rollback points
// - .flow/traces/        - Execution logs
// - .flow/ratchet/       - Blessed artifacts (stories, reports, tests)
// - .flow/context/       - Working memory (agent outputs for reflow learning)

export default {
	default_flow: 'development',

	persistence: {
		checkpoint_interval: 'every_turn',
	},

	pricing: {
		// Override model pricing (optional)
		// Defaults are loaded from agent/data/model-pricing.mjs
		// Use this if you have negotiated rates or want custom estimates
		overrides: {
			// Example:
			// 'gpt-4o': {
			//   input: 2.50,           // USD per 1M input tokens
			//   output: 10.00,          // USD per 1M output tokens
			//   context_window: 128000, // Max tokens
			// },
		},
	},

	flows: {
		development: {
			description: 'Develop features with tests.',
			aliases: ['dev'],
			max_flow_runs: 3,
			ask_before_reflow: true,
			agents: [
				'WRITE_USER_STORIES',
				'GENERATE_CODE',
				'PLAN_TESTS',
				'GENERATE_TESTS',
				'REVIEW',
				'CLEAN_AND_REFACTOR',
				'REPORT',
			],
		},
		testing: {
			description: 'Write and fix tests only (no new code).',
			aliases: ['test'],
			max_flow_runs: 2,
			ask_before_reflow: true,
			agents: [
				'GENERATE_TESTS',
				'REVIEW',
				'CLEAN_AND_REFACTOR',
				'REPORT',
			],
		},
		webui: {
			description: 'Generate web designs with iterative refinement.',
			aliases: ['web', 'ui'],
			max_flow_runs: 5,
			ask_before_reflow: true,
			agents: [
				'DESIGN_DOC',
				'RENDER_VIEWS',
				'PLAN_WORK',
				'EXECUTE_CODE',
				'REVIEW_DESIGN',
			],
		},
	},

	agents: [
		{
			name: 'WRITE_USER_STORIES',
			goal: 'Convert input to structured requirements',
			model: 'gpt-4o',
			max_turns: 6,
			complete_turns: true,
			settings: {
				temperature: 0.5,  // Balanced for clear specs with some creative phrasing
			},
			// Context injection: receive outputs from these agents on reflow/retry
			// Keys are agent names, values are boolean (true = inject, false = skip)
			context_injection: {
				REVIEW: true,   // Learn from rejection feedback
				REPORT: true,   // Learn from previous run reports
			},
			mcp_tools: {
				include: [],  // No tools - pure text transformation
			},
			file_constraints: {
				write_patterns: [],  // No file writes
			},
			prompt_file: './.flow/prompts/WRITE_USER_STORIES.md',
		},
		{
			name: 'GENERATE_CODE',
			goal: 'Write the implementation',
			model: 'gpt-4o-mini',
			max_turns: 9,
			settings: {
				temperature: 0.2,  // Low for consistent, precise code
				// top_p: 1,            // Nucleus sampling 0-1 (alternative to temperature)
				// max_tokens: 4096,    // Max output tokens
				// stop: ['---END---'], // Stop sequences (array, max 4)
			},
			context_injection: {
				REVIEW: true,   // Get specific code issues to fix
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file'],
			},
			file_constraints: {
				write_patterns: ['**/*.js', '**/*.mjs', 'package.json'],
				exclusions: [
					{
						patterns: ['**/*test*.mjs', '**/*test*.js', '**/*.spec.*'],
						message: 'Do not write test files. The GENERATE_TESTS agent handles testing later in the pipeline.',
					},
				],
			},
			prompt_file: './.flow/prompts/GENERATE_CODE.md',
		},
		{
			name: 'PLAN_TESTS',
			goal: 'Bridge the gap between stories and test code',
			model: 'gpt-4o',
			max_turns: 3,
			settings: {
				temperature: 0.3,  // Low for analytical, structured planning
			},
			mcp_tools: {
				include: ['list_directory', 'read_file'],  // Read-only
			},
			file_constraints: {
				write_patterns: [],  // Read-only
			},
			prompt_file: './.flow/prompts/PLAN_TESTS.md',
		},
		{
			name: 'GENERATE_TESTS',
			goal: 'Write and run the tests until they pass',
			model: 'gpt-4o-mini',
			max_turns: 12,
			settings: {
				temperature: 0.2,  // Low for precise, reproducible tests
			},
			context_injection: {
				REVIEW: true,   // Get specific test failures to fix
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file', 'run_node_tests', 'install_dependencies'],
			},
			file_constraints: {
				write_patterns: ['**/*.test.mjs', '**/*.new.test.mjs'],
				exclusions: [
					{
						patterns: ['**/*.js'],
						message: 'Do not modify source code. If tests fail, update your test expectations to match the implementation.',
					},
				],
			},
			prompt_file: './.flow/prompts/GENERATE_TESTS.md',
		},
		{
			name: 'REVIEW',
			goal: 'Audit the result before ratcheting',
			model: 'gpt-4o',
			max_turns: 3,
			is_gatekeeper: true,
			settings: {
				temperature: 0.1,  // Very low for deterministic, consistent gatekeeper decisions
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'run_node_tests'],  // Read-only + verify
			},
			file_constraints: {
				write_patterns: [],  // Read-only
			},
			prompt_file: './.flow/prompts/REVIEW.md',
		},
		{
			name: 'CLEAN_AND_REFACTOR',
			goal: 'Polish the codebase',
			model: 'gpt-4o',
			max_turns: 9,
			settings: {
				temperature: 0.3,  // Low for safe refactoring that preserves functionality
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file', 'run_node_tests'],
			},
			file_constraints: {
				write_patterns: ['**/*.js', '**/*.mjs'],  // Code and tests
			},
			prompt_file: './.flow/prompts/CLEAN_AND_REFACTOR.md',
		},
		{
			name: 'REPORT',
			goal: 'Summarize for the human',
			model: 'gpt-4o',
			max_turns: 6,
			settings: {
				temperature: 0.5,  // Balanced for clear documentation with varied presentation
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'run_node_tests'],  // Read + verify tests
			},
			file_constraints: {
				write_patterns: [],  // Read-only
			},
			prompt_file: './.flow/prompts/REPORT.md',
		},
		{
			name: 'DESIGN_DOC',
			goal: 'Convert user intent into structured web design document',
			model: 'mistralai/mistral-large',
			max_turns: 6,
			complete_turns: true,
			settings: {
				temperature: 0.7,  // Creative design thinking
			},
			context_injection: {
				REVIEW_DESIGN: true,  // Learn from design rejection feedback
			},
			mcp_tools: {
				include: [],  // No tools - pure text transformation
			},
			file_constraints: {
				write_patterns: [],  // No file writes
			},
			prompt_file: './.flow/prompts/DESIGN_DOC.md',
		},
		{
			name: 'RENDER_VIEWS',
			goal: 'Generate visual mockups and wireframes from design document',
			model: 'google/gemini-3-pro-image-preview',
			max_turns: 9,
			settings: {
				temperature: 0.5,  // Balanced creativity for visual design
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file'],
			},
			file_constraints: {
				write_patterns: ['**/*.png', '**/*.jpg', '**/*.svg', '**/*.html'],
			},
			prompt_file: './.flow/prompts/RENDER_VIEWS.md',
		},
		{
			name: 'PLAN_WORK',
			goal: 'Create implementation plan from design and mockups',
			model: 'mistralai/mistral-large',
			max_turns: 3,
			settings: {
				temperature: 0.4,  // Structured planning
			},
			mcp_tools: {
				include: ['list_directory', 'read_file'],  // Read-only
			},
			file_constraints: {
				write_patterns: [],  // Read-only
			},
			prompt_file: './.flow/prompts/PLAN_WORK.md',
		},
		{
			name: 'EXECUTE_CODE',
			goal: 'Implement the web UI code',
			model: 'moonshotai/kimi-k2',
			max_turns: 12,
			settings: {
				temperature: 0.2,  // Precise code generation
			},
			context_injection: {
				REVIEW_DESIGN: true,  // Get specific issues to fix from design review
			},
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file', 'run_node_tests'],
			},
			file_constraints: {
				write_patterns: ['**/*.html', '**/*.css', '**/*.js', '**/*.jsx', '**/*.json'],
			},
			prompt_file: './.flow/prompts/EXECUTE_CODE.md',
		},
		{
			name: 'REVIEW_DESIGN',
			goal: 'Review implementation against design document',
			model: 'mistralai/mistral-large',
			max_turns: 3,
			is_gatekeeper: true,
			settings: {
				temperature: 0.1,  // Very low for deterministic, consistent gatekeeper decisions
			},
			mcp_tools: {
				include: ['list_directory', 'read_file'],  // Read-only
			},
			file_constraints: {
				write_patterns: [],  // Read-only
			},
			prompt_file: './.flow/prompts/REVIEW_DESIGN.md',
		},
	],
}
