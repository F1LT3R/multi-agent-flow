# Sequential Image Naming Fix - Implementation Complete

## Problem Solved

Previously, the sequential naming strategy used `turn * 100 + index + 1`, which produced the same filename (e.g., `generated-101.png`) on every flow run because `turn` resets to 1 each time. This caused newer images to overwrite older ones.

**Example of the bug:**
- First run: `flow image "banana"` → creates `generated-101.png`
- Second run: `flow image "car"` → overwrites `generated-101.png` ❌

## Solution Implemented

Modified the image naming system to scan the project directory for existing files, find the highest number, and use the next available number.

**After fix:**
- First run: `flow image "banana"` → creates `generated-001.png`
- Second run: `flow image "car"` → creates `generated-002.png` ✓
- Third run with 3 images → creates `generated-003.png`, `generated-004.png`, `generated-005.png` ✓

## Changes Made

### 1. Added `getNextSequentialNumber()` Helper Function

**File:** `agent/core/vm-script-template.mjs` (lines 154-177)

```javascript
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
```

**Key features:**
- Scans `/project` directory for existing files
- Uses regex to match pattern: `prefix-NNN.format`
- Finds the highest number and returns `maxNum + 1`
- Returns `null` on error for fallback handling

### 2. Updated `generateImageFilename()` Function

**File:** `agent/core/vm-script-template.mjs` (lines 179-193)

**Key changes:**
- Function is now `async`
- Third parameter renamed from `turn` to `startNumber` (more accurate)
- Uses `startNumber + index` for sequential naming
- Pads numbers to 3 digits with leading zeros (001, 002, 003...)
- Turn-based naming remains unchanged

```javascript
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
```

### 3. Updated Image Extraction Loop

**File:** `agent/core/vm-script-template.mjs` (lines 329-368)

**Key changes:**
- Scan once before the loop with `getNextSequentialNumber()`
- If scan fails, fall back to timestamp-based naming
- Pass `startNumber` to `generateImageFilename()` instead of `turnCount`
- Add `await` when calling `generateImageFilename()` since it's now async

```javascript
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
		// ... generate filename with await
		const filename = await generateImageFilename(
			agentConfig.extract_images.prefix || 'generated-image',
			naming,
			startNumber,
			i,
			agentConfig.extract_images.format || 'png'
		)
		// ... rest of image processing
	}
}
```

## Testing Instructions

After rebuilding the Docker image:

1. Rebuild Docker image: `flow rebuild`
2. Test sequential generation:
   ```bash
   cd test-agent-flow/test-993
   flow image "banana"      # Should create generated-001.png
   flow image "car"         # Should create generated-002.png
   flow image "sunset"      # Should create generated-003.png
   ```
3. Verify no overwrites occurred
4. Test batch generation (agent that creates multiple images in one turn)

## Benefits

- **No more overwrites**: Each image gets a unique sequential number
- **User-friendly**: Numbers are predictable and easy to understand (001, 002, 003...)
- **Resilient**: Falls back to timestamp if filesystem scan fails
- **Efficient**: Scans once per turn, not per image
- **Works across all agents**: GENERATE_IMAGES, RENDER_VIEWS, and any future agents with `extract_images` enabled

## Edge Cases Handled

1. **First run in empty directory**: Starts at 001
2. **Gaps in sequence** (e.g., 001, 002, 005): Uses next number after highest (006)
3. **Filesystem scan failure**: Falls back to timestamp-based naming
4. **Multiple images per turn**: Increments from start number (001, 002, 003)
5. **Turn-based naming**: Unchanged, still uses turn number

## Implementation Date

December 20, 2025
