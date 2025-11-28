export default {
	"paths": {
		"tests": "./tests",
		"artifacts": "./tests/artifacts",
		"traces": "./.flow/logs/traces"
	},
	"persistence": {
		"checkpoint_interval": "every_turn",
		"checkpoints": "./.flow/logs/checkpoints",
		"log_dir": "./.flow/logs",
		"snapshots": "./.flow/snapshots"
	},
	"sequences": {
		"development": {
			"max_flow_runs": 3,
			"ask_before_reflow": true,
			"agents": [
				"WRITE_USER_STORIES",
				"GENERATE_CODE",
				"PLAN_TESTS",
				"GENERATE_TESTS",
				"REVIEW",
				"CLEAN_AND_REFACTOR",
				"REPORT"
			]
		}
	},
	"agents": [
		{
			"name": "WRITE_USER_STORIES",
			"goal": "Convert input to structured requirements",
			"model": "gpt-4o",
			"max_turns": 6,
			"complete_turns": true,
			"mcp_tools": {
				"include": [
					"file_ops",
					"internet"
				],
				"exclude": [
					"run_tests"
				]
			},
			"prompt_file": "./prompts/WRITE_USER_STORIES.md"
		},
		{
			"name": "GENERATE_CODE",
			"goal": "Write the implementation",
			"model": "gpt-4o-mini",
			"max_turns": 9,
			"mcp_tools": {
				"include": [
					"file_ops",
					"internet"
				],
				"exclude": [
					"run_tests"
				]
			},
			"prompt_file": "./prompts/GENERATE_CODE.md"
		},
		{
			"name": "PLAN_TESTS",
			"goal": "Bridge the gap between stories and test code",
			"model": "gpt-4o",
			"max_turns": 3,
			"mcp_tools": {
				"include": [
					"file_ops"
				],
				"exclude": [
					"run_tests"
				]
			},
			"prompt_file": "./prompts/PLAN_TESTS.md"
		},
		{
			"name": "GENERATE_TESTS",
			"goal": "Write and run the tests until they pass",
			"model": "gpt-4o-mini",
			"max_turns": 12,
			"mcp_tools": {
				"include": [
					"file_ops",
					"run_tests"
				],
				"exclude": []
			},
			"prompt_file": "./prompts/GENERATE_TESTS.md"
		},
		{
			"name": "REVIEW",
			"goal": "Audit the result before ratcheting",
			"model": "gpt-4o",
			"max_turns": 3,
			"is_gatekeeper": true,
			"mcp_tools": {
				"include": [
					"file_ops",
					"run_tests"
				],
				"exclude": []
			},
			"prompt_file": "./prompts/REVIEW.md"
		},
		{
			"name": "CLEAN_AND_REFACTOR",
			"goal": "Polish the codebase",
			"model": "gpt-4o",
			"max_turns": 9,
			"mcp_tools": {
				"include": [
					"file_ops",
					"run_tests"
				],
				"exclude": []
			},
			"prompt_file": "./prompts/CLEAN_AND_REFACTOR.md"
		},
		{
			"name": "REPORT",
			"goal": "Summarize for the human",
			"model": "gpt-4o",
			"max_turns": 6,
			"mcp_tools": {
				"include": [
					"file_ops"
				],
				"exclude": []
			},
			"prompt_file": "./prompts/REPORT.md"
		}
	]
}
