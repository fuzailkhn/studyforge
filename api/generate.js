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
    promptText = `You are a study assistant answering questions about the provided source material. ${historyText}Now answer this question clearly and directly, using only the source material as your basis: "${question}"
Reply in plain conversational text, no JSON, no markdown formatting, just a clear direct answer.`;
  } else if (hasImages) {
    promptText = `You are a study assistant. Look at these image(s) and do two things:
1. Transcribe all the readable text from the image(s) as accurately as possible into a field called "extractedText".
2. Create a thorough study guide and flashcards from that content.
Return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"extractedText":"...", "guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
Make the guide 5-7 sections with 3-5 points each. Make 8-12 flashcards. Double-check your JSON syntax is valid before finishing — each object must have exactly one closing brace.`;
  } else {
    promptText = `You are a study assistant. Whatever the user provides — notes, a topic, or a request — create a thorough study guide and flashcards that directly address it.
Return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
Make the guide 5-7 sections with 3-5 points each. Make 8-12 flashcards. Double-check your JSON syntax is valid before finishing — each object must have exactly one closing brace.`;
  }

  const useImages = hasImages && !isChat;
  const maxTokens = extractOnly ? 1500 : (useImages ? 2200 : (isChat ? 800 : 5500));

  function buildBody() {
    if (useImages) {
      const content = [{ type: "text", text: promptText }];
      images.forEach(img => content.push({ type: "image_url", image_url: { url: img } }));
      return {
        model: "qwen/qwen3.6-27b",
        messages: [{ role: "user", content }],
        temperature: 0.2,
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
        temperature: 0.3,
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

  let { response, data } = await callGroq();

  if (!response.ok && data.error?.code === "json_validate_failed") {
    console.log("Retrying after JSON validation failure...");
    ({ response, data } = await callGroq());
  }

  if (!response.ok || !data.choices) {
    console.error("Groq error:", JSON.stringify(data));
    let friendly = "Something went wrong. Please try again.";
    if (data.error?.code === "rate_limit_exceeded") {
      friendly = "You're asking questions a bit fast — please wait about 30 seconds and try again.";
    } else if (data.error?.code === "json_validate_failed") {
      friendly = "The AI had trouble formatting its response — please try again.";
    }
    return res.status(200).json({ content: [{ text: "" }], debug: data, friendlyError: friendly });
  }

  let text = data.choices?.[0]?.message?.content || "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  res.status(200).json({ content: [{ text }], debug: null, friendlyError: null });
}
