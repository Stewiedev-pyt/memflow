export interface NewsPost {
  title: string;
  url: string;
  votes?: number;
}

export async function getNews(symbol: string, limit = 3): Promise<NewsPost[]> {
  const token = process.env.CRYPTOPANIC_API_KEY;
  if (!token) return [];
  try {
    const url = `https://cryptopanic.com/api/free/v1/posts/?auth_token=${token}&currencies=${encodeURIComponent(symbol.toUpperCase())}&public=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title: string; url: string; votes?: number }> };
    return (data.results ?? []).slice(0, limit).map((r) => ({ title: r.title, url: r.url, votes: r.votes }));
  } catch {
    return [];
  }
}
