export default async function handler(req, res) {
  const { notes, detail } = req.body;

  const detailInstructions = {
    quick: "Make the guide 2-3 concise sections. Make 5 flashcards. Keep points short.",
    standard: "Make the guide 3-6 sections. Make 6-10 flashcards.",
    detailed: "Make the guide 5-8 thorough sections, each with 4-6 detailed points explaining concepts fully, including examples where relevant. Make 10-15 flashcards covering nuances, not just definitions."
  };
  const instruction = detailInstructions[detail] || detailInstructions.standard;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: `You are a study assistant. Given these notes, return ONLY valid JSON (no markdown, no backticks) in this exact shape:
{"guide":[{"heading":"...", "points":["...","..."]}], "flashcards":[{"q":"...","a":"..."}]}
${instruction}
Notes:
"""${notes}"""`
      }],
      temperature: 0.5,
      max_tokens: 3000
    })
  });

  const data = await response.json();
  const text = data.choices[0].message.content;
  res.status(200).json({ content: [{ text }] });
}
