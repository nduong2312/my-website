// Cloudflare Worker — backend cho chatbot AI.
// Xử lý POST /api/chat, gọi Workers AI và stream kết quả về trình duyệt.

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Env {
  // Binding Workers AI (khai báo trong wrangler.jsonc: "ai": { "binding": "AI" })
  AI: {
    run(model: string, options: unknown): Promise<ReadableStream>;
  };
}

// Model AI sử dụng. Có thể đổi sang model khác của Workers AI bất cứ lúc nào.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = `Bạn là một trợ lý AI thân thiện, thông minh và hữu ích.
Hãy trả lời rõ ràng, chính xác và ngắn gọn. Mặc định trả lời bằng tiếng Việt,
nhưng nếu người dùng dùng ngôn ngữ khác thì hãy đáp lại bằng đúng ngôn ngữ đó.
Khi cần, hãy dùng định dạng markdown (danh sách, **in đậm**, khối code) để câu trả lời dễ đọc.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      return handleChat(request, env);
    }

    // Các route /api/* khác: không tồn tại.
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    // Tệp tĩnh (HTML/CSS/JS) do tầng assets của Cloudflare phục vụ tự động.
    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const history = Array.isArray(body.messages) ? body.messages : [];

    // Lọc, làm sạch và giới hạn lịch sử để tránh prompt quá dài.
    const cleaned = history
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .slice(-20);

    if (cleaned.length === 0) {
      return Response.json({ error: "Thiếu nội dung tin nhắn." }, { status: 400 });
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...cleaned,
    ];

    const stream = await env.AI.run(MODEL, {
      messages,
      stream: true,
      max_tokens: 1024,
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định";
    return Response.json({ error: message }, { status: 500 });
  }
}
