export default async function handler(req, res) {
  const { notes, question, images, history, extractOnly } = req.body;

  const hasImages = images && images.length > 0;
  const isChat = question && question.length > 0;

  let promptText;
  if (extractOnly) {
    promptText = `Transcribe all readable text from these image(s) as accurately as possible. Return ONLY valid JSON (no markdown, no backticks) in this exact shape: {"extractedText":"..."}`;
  } else if (isChat) {
    let historyText = "";
    if (history && history.length > 0) {
      historyText = "Previous conversation:\n" + history.map(h => `Q: ${h.q}\nA: ${h.a}`).join("\n") + "\n\n";
    }
    promptText = `You are a study and coding assistant answering questions about the provided source material, or helping with code. ${historyText}Now respond to this: "${question}"
Rules:
- If this involves writing, fixing, or modifying code in ANY programming language, put the COMPLETE, properly indented code inside a fenced block like: \`\`\`language\ncode here\n\`\`\`. Always give the full working code, not just a snippet, even when asked to change something — rewrite the whole thing with the change applied.
- If it's a study/content question, answer in plain clear text, no JSON, no code fences.
- You can mix both: brief explanation text plus a code block, if that fits the request.`;
  } else if (hasImages) {
    promptText = `You are a study assistant. Look at these image(s) and do two things:
1. Transcribe all readable text into a field called "extractedText".
2. Create a thorough study guide and flashcards from that content.
Return ONLY valid JSON in this EXACT shape, every flashcard a plain {"q":"...","a":"..."} object:
{"extractedText":"...", "guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."},{"q":"...","a":"..."}]}
Make the guide 5-7 sections with 3-5 points each. Make 8-12 flashcards.`;
  } else {
    promptText = `You are a study and coding assistant. The user's request may be to write/explain code in any programming language, OR to study notes/a topic. Decide which it is.

Return ONLY valid JSON in this EXACT shape:
{"code": {"language":"...", "content":"..."} or null, "guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."},{"q":"...","a":"..."}]}

Rules:
- If the request is about writing/explaining code: put the COMPLETE, properly indented, working code in "code.content" (use \\n for line breaks, preserve indentation exactly), set "code.language" to the language name. Still include a short "guide" (2-4 sections) explaining how the code works, and flashcards testing understanding of it.
- If the request is NOT about code: set "code" to null, and build a normal thorough study guide (5-7 sections, 3-5 points each) and 8-12 flashcards from the material.
- Never put code inside "guide" points — code always goes in the "code" field only.`;
  }

  const useImages = hasImages && !isChat;
  const maxTokens = extractOnly ? 1500 : (useImages ? 2200 : (isChat ? 2000 : 6000));

  function buildBody() {
    if (useImages) {
      const content = [{ type: "text", text: promptText }];
      images.forEach(img => content.push({ type: "image_url", image_url: { url: img } }));
      return {
        model: "qwen/qwen3.6-27b",
        messages: [{ role: "user", content }],
        temperature: 0.15,
        max_tokens: maxTokens,
        reasoning_effort: "none",
        response_format: { type: "json_object" }
      };
    } else {
      return {
        model: "openai/gpt-oss-120b",
        messages: [{
          role: "user",
          content: `${promptText}\n\nSource material:\n"""${notes}"""`
        }],
        temperature: 0.2,
        max_tokens: maxTokens,
        reasoning_effort: "low",
        ...(isChat ? {} : { response_format: { type: "json_object" } })
      };
    }
  }

  async function callGroq() {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(buildBody())
    });
    return { response, data: await response.json() };
  }

  function isValidShape(text) {
    if (extractOnly || isChat) return true;
    try {
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed.guide) || !Array.isArray(parsed.flashcards)) return false;
      for (const sec of parsed.guide) {
        if (typeof sec.heading !== "string" || !Array.isArray(sec.points)) return false;
      }
      for (const card of parsed.flashcards) {
        if (typeof card !== "object" || card === null || typeof card.q !== "string" || typeof card.a !== "string") return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  let text = "";
  let lastData = null;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { response, data } = await callGroq();
    lastData = data;

    if (!response.ok || !data.choices) {
      if (data.error?.code === "json_validate_failed" || data.error?.code === "rate_limit_exceeded") {
        if (attempt < maxAttempts - 1) continue;
      }
      console.error("Groq error:", JSON.stringify(data));
      let friendly = "Something went wrong. Please try again.";
      if (data.error?.code === "rate_limit_exceeded") {
        friendly = "You're asking questions a bit fast — please wait about 30 seconds and try again.";
      } else if (data.error?.code === "json_validate_failed") {
        friendly = "The AI had trouble formatting its response — please try again.";
      }
      return res.status(200).json({ content: [{ text: "" }], debug: data, friendlyError: friendly });
    }

    let candidate = data.choices?.[0]?.message?.content || "";
    candidate = candidate.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    if (isValidShape(candidate)) {
      text = candidate;
      break;
    }
    console.log(`Attempt ${attempt + 1}: malformed structure, retrying...`);
    text = candidate;
  }

  if (!text) {
    return res.status(200).json({ content: [{ text: "" }], debug: lastData, friendlyError: "Couldn't generate a valid response after a few tries. Please try again." });
  }

  res.status(200).json({ content: [{ text }], debug: null, friendlyError: null });
}
