# Model Settings

Configure per-agent model parameters in `flow.config.mjs` to control AI behavior.

## Available Settings

| Setting | Type | Range | Description |
|---------|------|-------|-------------|
| `temperature` | number | 0-2 | Randomness (higher = more creative, lower = more deterministic) |
| `top_p` | number | 0-1 | Nucleus sampling (alternative to temperature, use one or the other) |
| `max_tokens` | number | 1+ | Maximum output tokens |
| `stop` | string[] | max 4 | Array of stop sequences that halt generation |

## Configuration Example

```javascript
// flow.config.mjs
{
    agents: [
        {
            name: 'GENERATE_CODE',
            goal: 'Write the implementation',
            model: 'gpt-4o-mini',
            max_turns: 9,
            settings: {
                temperature: 0.7,
                // top_p: 1,            // Alternative to temperature
                // max_tokens: 4096,    // Limit output length
                // stop: ['---END---'], // Stop at these sequences
            },
            mcp_tools: { ... },
            prompt_file: './prompts/GENERATE_CODE.md',
        },
    ]
}
```

## How to Verify Settings Are Applied

### Check Trace Files

Trace files in `.flow/logs/traces/` log each turn's details. Look for:
- Token usage matching `max_tokens` limits
- Generation stopping at expected sequences

### Observable Behaviors

Test different settings to verify they're working:

| Setting | Test | Expected Behavior |
|---------|------|-------------------|
| `temperature: 0` | Run same prompt twice | Nearly identical outputs |
| `temperature: 2` | Run same prompt twice | Highly varied, creative outputs |
| `max_tokens: 50` | Any prompt | Responses cut off mid-sentence |
| `stop: ['END']` | Prompt that generates "END" | Generation stops at that word |

### Testing Tips

1. **Single Agent Testing**: Use `flow mode AGENT_NAME "test prompt"` to test one agent in isolation

2. **Compare Outputs**: Run the same prompt with different temperature values to verify the setting affects output variability

3. **Token Limits**: Check the token counts in the flow summary - completion tokens should not exceed `max_tokens`

4. **Stop Sequences**: Add a stop sequence and verify output ends when that sequence would be generated

## Provider Compatibility

These settings are compatible across major providers:

| Setting | OpenAI | Anthropic | Google | xAI |
|---------|--------|-----------|--------|-----|
| `temperature` | ✓ | ✓ | ✓ | ✓ |
| `top_p` | ✓ | ✓ | ✓ | ✓ |
| `max_tokens` | ✓ | ✓ | ✓ | ✓ |
| `stop` | ✓ (max 4) | ✓ | ✓ | ✓ |

**Note**: The `stop` setting accepts an array of strings (max 4 elements) for cross-provider compatibility.

## Best Practices

1. **Don't mix `temperature` and `top_p`** - Use one or the other, not both

2. **Lower temperature for code generation** - Values like 0.2-0.5 produce more consistent, reliable code

3. **Higher temperature for creative tasks** - Values like 0.8-1.2 for brainstorming or story writing

4. **Set `max_tokens` thoughtfully** - Too low cuts off responses; too high wastes tokens

5. **Use stop sequences sparingly** - Only when you need to explicitly end generation at a known boundary

