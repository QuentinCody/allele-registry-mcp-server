import {fail} from "./batch";
export async function registryRead(url: URL, method: string, body?: string) {
  let response: Response;
  try { response = await fetch(url, {method, body, headers: {Accept: "application/json", ...(body !== undefined ? {"Content-Type": "text/plain; charset=utf-8"} : {})}, redirect: "manual", signal: AbortSignal.timeout(50000)}); }
  catch { fail("Allele Registry request failed or timed out", 502); }
  const reader = response.body?.getReader();
  if (!reader) fail("Empty Allele Registry response", response.ok ? 502 : response.status);
  let raw = ""; let bytes = 0;
  const decoder = new TextDecoder("utf-8", {fatal: true});
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 4 * 1024 * 1024) fail("Response exceeds 4 MiB", 502);
      raw += decoder.decode(chunk.value, {stream: true});
    }
    raw += decoder.decode();
  } catch { fail("Allele Registry response unreadable or exceeds 4 MiB; reduce batch size or fields", response.ok ? 502 : response.status); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { fail("Invalid Allele Registry JSON", response.ok ? 502 : response.status); }
  const version = response.headers.get("X-CAR-Version");
  const registry_version = version && version.length <= 128 ? version : null;
  if (!response.ok) fail(`Allele Registry HTTP ${response.status}`, response.status, {provider_response: data, retry_after: response.headers.get("Retry-After"), registry_version});
  if (data && typeof data === "object" && !Array.isArray(data) && "errorType" in data) fail("Allele Registry returned an error", 502, {provider_response: data, registry_version});
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return {status: response.status, data, provenance: {source_url: url.href, retrieved_at: new Date().toISOString(), registry_version, response_sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}};
}
