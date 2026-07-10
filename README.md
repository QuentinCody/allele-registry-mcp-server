# allele-registry-mcp-server

MCP server wrapping the **ClinGen Allele Registry** (`https://reg.clinicalgenome.org`) — canonical allele identity for genetic variants. Resolves any HGVS / dbSNP / ClinVar / gnomAD reference to a stable **ClinGen Allele Registry ID (`CA#`)** and its cross-references, so a variant keeps one identity across genome builds and transcript versions.

Cloudflare Worker built on `McpAgent` (`agents/mcp`), REST + Code Mode via `@bio-mcp/shared`. Read endpoints only; no auth. Dev port **8905**.

## Why it exists

tmVar3's ~550 GB of chromosome-sharded SQLite exists to turn an HGVS string into a canonical allele. The Allele Registry does the same thing over a free public REST API — so we wrap the API instead of re-hosting the index. Every `allele_registry_execute` result carries a verifiable `_meta.citation`, and a `CA#` is a content-addressed allele identifier that drops straight into the fleet's attestation story.

## Tools (Code Mode)

- `allele_registry_search` — discover endpoints in the curated catalog
- `allele_registry_execute` — run JS against the API in a V8 isolate (`api.get`/`api.post`, `searchSpec`, no network/keys); results carry `_meta.citation`
- `allele_registry_get_schema` / `allele_registry_query_data` — inspect + SQL-query staged results

## Develop

```bash
./scripts/dev-servers.sh allele-registry   # wrangler dev on :8905
pnpm --filter allele-registry-mcp-server run test
```

## Upstream

- Base: `https://reg.clinicalgenome.org` — `GET /allele?hgvs=…`, `GET /allele/{CAid}`, resolution by dbSNP / ClinVar / gnomAD / MyVariantInfo.
- Source descriptor: `ClinGen Allele Registry` (ClinGen / NIH, freely available).
