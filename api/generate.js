export default async function handler(req, res) {
  const { notes, detail, images } = req.body;

  const detailInstructions = {
    quick: "Make the guide 2-3 concise sections. Make 5 flashcards. Keep points short.",
    standard: "Make the guide 3-6 sections. Make 6-10 flashcards.",
    detailed: "Make the guide 5-8 thorough sections, each with 4-6 detailed points explaining concepts fully, including examples where relevant. Make 10-15 flashcards covering nuances, not just definitions."
  };
  const instruction = detailInstructions[detail] || detailInstructions.standard;
  const jsonInstruction = `Return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
${instruction}`;

  let body;
  if (images && images.length > 0) {
    const content = [
      { type: "text", text: `You are a study assistant. Read the text in these image(s) of notes/document pages and create a study guide and flashcards from what they contain. ${jsonInstruction}` }
    ];
    images.forEach(img => {
      content.push({ type: "image_url", image_url: { url: img } });
    });
    body = {
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{ role: "user", content }],
      temperature: 0.5,
      max_tokens: 3000
    };
  } else {
    body = {
      model: "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: `You are a study assistant. Given these notes, create a study guide and flashcards. ${jsonInstruction}
Notes:
"""${notes}"""`
      }],
      temperature: 0.5,
      max_tokens: 3000
    };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok || !data.choices) {
    console.error("Groq error:", JSON.stringify(data));
    return res.status(200).json({ content: [{ text: "" }], debug: data });
  }

  const text = data.choices?.[0]?.message?.content || "";
  res.status(200).json({ content: [{ text }], debug: null });
}
