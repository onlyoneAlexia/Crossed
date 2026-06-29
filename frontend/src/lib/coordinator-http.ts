export async function coordinatorHttpError(prefix: string, response: Response): Promise<Error> {
  let detail = "";
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        detail = String(parsed?.error ?? parsed?.message ?? text);
      } catch {
        detail = text;
      }
    }
  } catch {
    detail = "";
  }
  const fallback = response.statusText || "request failed";
  return new Error(`${prefix}: ${response.status} ${detail || fallback}`);
}
