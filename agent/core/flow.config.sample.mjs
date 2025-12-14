// Multi-Agent Flow Configuration
// All paths are hardcoded relative to project root:
// - .flow/prompts/       - Agent prompt files
// - .flow/checkpoints/   - Resume state
// - .flow/snapshots/     - Rollback points
// - .flow/traces/        - Execution logs
// - .flow/ratchet/       - Blessed artifacts (stories, reports, tests)

export default {
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
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file'],
			},
			file_constraints: {
				write_patterns: ['**/*.js', '**/*.mjs', 'package.json'],
				exclude_patterns: ['**/*.test.js', '**/*.test.mjs'],  // Tests are GENERATE_TESTS's job
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
			mcp_tools: {
				include: ['list_directory', 'read_file', 'write_file', 'run_node_tests', 'install_dependencies'],
			},
			file_constraints: {
				write_patterns: ['**/*.test.mjs', '**/*.new.test.mjs'],  // Tests only
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
	],
}
