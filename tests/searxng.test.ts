/**
 * roundhouse fork: the self-hosted SearXNG engine — resolution precedence
 * (a configured instance wins the auto-detect) + the adapter's wire shape
 * against a STUB fetch (never the network).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSearchEngineFor, searxngProvider } from "../src/server/search.ts";

describe("SearXNG engine resolution", () => {
	it("a configured instance alone makes search live", () => {
		const out = resolveSearchEngineFor(undefined, { searxng: "http://127.0.0.1:8888" });
		assert.ok(out.available);
		assert.equal(out.engine, "searxng");
		assert.equal(out.key, "http://127.0.0.1:8888");
	});

	it("wins the auto-detect over Tavily and Brave keys", () => {
		const out = resolveSearchEngineFor(undefined, {
			searxng: "http://127.0.0.1:8888",
			tavily: "tvly-throwaway-key-00001",
			brave: "brave-throwaway-key-00001",
		});
		assert.equal(out.engine, "searxng");
	});

	it("an explicit Tavily pin still beats it", () => {
		const out = resolveSearchEngineFor("tavily", { searxng: "http://127.0.0.1:8888", tavily: "tvly-throwaway-key-00001" });
		assert.equal(out.engine, "tavily");
	});
});

describe("searxngProvider (wire shape)", () => {
	it("GETs {base}/search?format=json, maps results, caps the count", async () => {
		let seen = "";
		const provider = searxngProvider("http://127.0.0.1:8888", async (input) => {
			seen = input;
			return new Response(
				JSON.stringify({
					results: [
						{ title: "A", url: "https://a.example", content: "line one\nline two" },
						{ title: "no url" },
						{ title: "B", url: "https://b.example", content: "b" },
						{ title: "C", url: "https://c.example", content: "c" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const hits = await provider.search("stokes theorem", 2);
		const url = new URL(seen);
		assert.equal(url.origin + url.pathname, "http://127.0.0.1:8888/search");
		assert.equal(url.searchParams.get("q"), "stokes theorem");
		assert.equal(url.searchParams.get("format"), "json");
		assert.deepEqual(hits, [
			{ title: "A", url: "https://a.example", snippet: "line one line two" },
			{ title: "B", url: "https://b.example", snippet: "b" },
		]);
	});

	it("keeps a base path (reverse-proxied instance)", async () => {
		let seen = "";
		const provider = searxngProvider("https://host.example/searx/", async (input) => {
			seen = input;
			return new Response(JSON.stringify({ results: [] }), { status: 200 });
		});
		await provider.search("q", 5);
		assert.ok(seen.startsWith("https://host.example/searx/search?"), seen);
	});

	it("maps an HTTP error to a clear Error", async () => {
		const provider = searxngProvider("http://127.0.0.1:8888", async () => new Response("Forbidden: format json", { status: 403 }));
		await assert.rejects(provider.search("q", 5), /SearXNG 403: Forbidden/);
	});
});
