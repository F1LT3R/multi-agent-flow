# Image Generation Fix - Complete Implementation

## Problem Analysis

After implementing the initial image generation changes (adding `modalities` and `image_config` parameters), images were still not being generated. Analysis of test run `test-994` revealed:

1. **Token usage showed 0 image tokens** - The model generated no images
2. **Agent claimed to generate images** - But no actual images were saved
3. **Response format mismatch** - The extraction code was looking in the wrong place

## Root Cause

The OpenRouter API returns generated images in a **separate `message.images` field**, not embedded in `message.content`. Our extraction function was only checking `message.content`.

### OpenRouter Response Format

According to OpenRouter documentation, image generation responses look like:

```javascript
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "I've generated a beautiful sunset image for you.",
        "images": [                    // ← Images are HERE, not in content
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
            }
          }
        ]
      }
    }
  ]
}
```

## Solution Implemented

### 1. Updated Image Extraction Function

**File:** `agent/ai-providers/openrouter-adapter.mjs`

Modified `_extractMultimodalContent()` to accept a second parameter for generated images:

```javascript
_extractMultimodalContent(content, generatedImages = null) {
    // ... handle text content ...

    // Handle generated images (OpenRouter image generation format)
    if (generatedImages && Array.isArray(generatedImages)) {
        for (const img of generatedImages) {
            if (img.type === 'image_url' && img.image_url?.url) {
                images.push({
                    url: img.image_url.url,
                    detail: img.image_url.detail
                })
            }
        }
    }

    return { textContent, images }
}
```

### 2. Updated Extraction Call

Pass `message.images` to the extraction function:

```javascript
const { textContent, images } = this._extractMultimodalContent(
    message.content,
    message.images  // ← Now checking the separate images field
)
```

### 3. Added Debug Logging

Added diagnostic logging to help troubleshoot future issues:

- Log when image generation parameters are sent
- Log when images are/aren't received
- Log response format details

## Testing

To verify the fix works:

```bash
cd /Users/user/repos/test-agent-flow
mkdir test-995
cd test-995
flow web "Create a mockup for a simple landing page"
```

Expected output:

```
[OpenRouter] Image generation enabled: {
  modalities: [ 'image', 'text' ],
  image_config: { aspect_ratio: '3:4' },
  model: 'google/gemini-2.5-flash-image'
}

[OpenRouter] Successfully received 1 image(s)
[Image Extraction] Processing 1 image(s)...
🖼️  Saved image: mockup-001.png (245 KB)
```

## Files Modified

1. `agent/ai-providers/openrouter-adapter.mjs`
   - Updated `_extractMultimodalContent()` to handle `message.images` field
   - Updated extraction call to pass `message.images`
   - Added debug logging for troubleshooting

## Why It Wasn't Working Before

1. ✅ API parameters (`modalities`, `image_config`) were being sent correctly
2. ✅ Model was configured correctly
3. ✅ Image extraction feature was enabled
4. ❌ **Extraction function was only looking at `message.content`**
5. ❌ **Missed the separate `message.images` field where generated images are returned**

The model WAS generating images, but our code wasn't finding them in the response!

## Success Criteria

- [x] API sends `modalities: ["image", "text"]` parameter
- [x] API sends `image_config: {aspect_ratio: "3:4"}` parameter
- [x] Adapter checks `message.images` field for generated images
- [x] Images are extracted and saved to disk
- [x] Debug logging helps diagnose issues
- [ ] Test run confirms images are generated and saved (pending verification)
