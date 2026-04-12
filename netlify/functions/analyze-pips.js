exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { imageData, mimeType } = JSON.parse(event.body);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing API key" }),
      };
    }

    // --- Configuration ---
    // Switch to "gemini-2.5-pro" for better accuracy (slower, ~10-15s)
    const MODEL = "gemini-2.5-flash";
    const PASSES = 3;
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const prompt = `You are counting pips (dots) on domino tiles. Be precise — accuracy matters more than speed.

STEP-BY-STEP METHOD:
1. First, identify how many domino tiles are in the image. Each tile has a center dividing line separating a LEFT half from a RIGHT half.
2. For EACH tile, count the LEFT half and RIGHT half separately.
3. To count pips on a half:
   - Note the pip arrangement. Domino pips are arranged in a grid pattern.
   - Count ROW BY ROW from top to bottom. Write out how many pips are in each row.
   - Add the rows to get the half total.
4. Repeat for every half of every tile.
5. Sum all tile totals for the grand total.

IMPORTANT NOTES:
- These are Double-12 dominoes, so each half can have 0 to 12 pips.
- High-pip halves (9-12) have pips arranged in a rectangular grid: e.g., 12 pips = 4 columns × 3 rows, 10 pips = 2 columns × 5 rows or similar.
- All pips on a single half are the SAME color. Different halves may have different colors.
- Do NOT confuse the center dividing line with pips.
- Count slowly and carefully. Double-check any half where you count more than 8.

OUTPUT FORMAT (use exactly this, no other text before or after):
TILE 1: left=<number> right=<number> sum=<number>
TILE 2: left=<number> right=<number> sum=<number>
...
TOTAL: <number>`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: imageData,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.1,
      },
    };

    // --- Multi-pass consensus ---
    const promises = Array.from({ length: PASSES }, () =>
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }).then((r) => r.json())
    );

    const results = await Promise.all(promises);
    const counts = [];
    const debugInfo = [];

    for (let i = 0; i < results.length; i++) {
      const parsed = parseGeminiResponse(results[i]);
      debugInfo.push({
        pass: i + 1,
        count: parsed.count,
        tiles: parsed.tiles,
        raw: parsed.raw,
      });
      if (parsed.count !== null) {
        counts.push(parsed.count);
      }
    }

    console.log("Pass results:", JSON.stringify(debugInfo, null, 2));

    if (counts.length === 0) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          error: "Could not parse count from any pass",
          debug: debugInfo,
        }),
      };
    }

    // Take the median
    counts.sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];

    console.log(`Counts: [${counts.join(", ")}] → median: ${median}`);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count: median,
        passes: counts,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

/**
 * Extract the non-thinking text part from a Gemini response
 */
function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.filter((p) => p.text && !p.thought).pop();
  return textPart?.text?.trim() ?? "";
}

/**
 * Parse a Gemini response to extract the pip count.
 * Prefers recomputed per-tile sums over the model's stated TOTAL.
 */
function parseGeminiResponse(data) {
  const text = extractText(data);
  if (!text) return { count: null, tiles: [], raw: "" };

  // Parse per-tile lines
  const tilePattern =
    /TILE\s+\d+\s*:\s*left\s*=\s*(\d+)\s*,?\s*right\s*=\s*(\d+)\s*,?\s*sum\s*=\s*(\d+)/gi;
  const tiles = [];
  let recomputedTotal = 0;
  let match;

  while ((match = tilePattern.exec(text)) !== null) {
    const left = parseInt(match[1], 10);
    const right = parseInt(match[2], 10);
    const stated = parseInt(match[3], 10);
    // Always recompute — catches model arithmetic errors
    const computed = left + right;
    tiles.push({ left, right, stated, computed });
    recomputedTotal += computed;
  }

  if (tiles.length > 0) {
    return { count: recomputedTotal, tiles, raw: text };
  }

  // Fallback: TOTAL: N
  const totalMatch = text.match(/TOTAL[:\s]+(\d+)/i);
  if (totalMatch) {
    return {
      count: parseInt(totalMatch[1], 10),
      tiles: [],
      raw: text,
    };
  }

  // Last resort: last number in response
  const allNums = text.match(/\d+/g);
  if (allNums && allNums.length > 0) {
    return {
      count: parseInt(allNums[allNums.length - 1], 10),
      tiles: [],
      raw: text,
    };
  }

  return { count: null, tiles: [], raw: text };
}
