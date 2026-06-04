/* API Proxy — forwards requests to backend with cookies */
import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "https://institutionalinvestorhub.com";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const backendPath = `/api/${path.join("/")}`;
  const url = new URL(backendPath, BACKEND);
  url.search = request.nextUrl.search;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.Cookie = cookie;

  try {
    const res = await fetch(url.toString(), { headers });
    const data = await res.json();

    const response = NextResponse.json(data, { status: res.status });
    // Forward set-cookie headers
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) response.headers.set("set-cookie", setCookie);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable" },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const backendPath = `/api/${path.join("/")}`;
  const url = new URL(backendPath, BACKEND);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.Cookie = cookie;

  try {
    const body = await request.text();
    const res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body,
    });
    const data = await res.json();
    const response = NextResponse.json(data, { status: res.status });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) response.headers.set("set-cookie", setCookie);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable" },
      { status: 502 }
    );
  }
}
