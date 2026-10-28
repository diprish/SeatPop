import { describe, expect, it } from "vitest";
import {
  Geocoder,
  loadOverrides,
  memoryGeocodeCache,
} from "../src/ingest/geocode";

const OVERRIDES = new URL(
  "./fixtures/geocode-overrides.json",
  import.meta.url,
).pathname;

function mockFetch(
  handler: (url: string) => Response,
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    urls.push(String(url));
    return handler(String(url));
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe("geocoder", () => {
  it("loads overrides and ignores comment keys", () => {
    const overrides = loadOverrides(OVERRIDES);
    expect(overrides["Parliament Hill, Ottawa"]).toEqual({
      lat: 45.4236,
      lng: -75.7009,
    });
    expect(loadOverrides("/nonexistent/geocode-overrides.json")).toEqual({});
  });

  it("serves overrides and cache without network calls", async () => {
    const { fetchImpl, urls } = mockFetch(
      () => new Response("[]", { status: 200 }),
    );
    const geocoder = new Geocoder({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      cache: memoryGeocodeCache(),
      overrides: loadOverrides(OVERRIDES),
      minDelayMs: 1,
    });
    const hit = await geocoder.geocode("Parliament Hill, Ottawa");
    expect(hit).toEqual({ lat: 45.4236, lng: -75.7009, confidence: 1 });
    expect(urls).toHaveLength(0);
  });

  it("queries nominatim once per address and caches", async () => {
    const { fetchImpl, urls } = mockFetch(
      () =>
        new Response(
          JSON.stringify([{ lat: "45.42", lon: "-75.69", importance: 0.8 }]),
          { status: 200 },
        ),
    );
    const geocoder = new Geocoder({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      cache: memoryGeocodeCache(),
      minDelayMs: 1,
    });
    const first = await geocoder.geocode("120 Metcalfe St, Ottawa");
    expect(first).toEqual({ lat: 45.42, lng: -75.69, confidence: 0.8 });
    expect(urls[0]).toContain("nominatim.openstreetmap.org/search");
    expect(urls[0]).toContain("countrycodes=ca");
    const second = await geocoder.geocode("120 Metcalfe St, Ottawa");
    expect(second).toEqual(first);
    expect(urls).toHaveLength(1);
  });

  it("resolves misses and errors to null", async () => {
    const { fetchImpl } = mockFetch((url) =>
      url.includes("nowhere")
        ? new Response("[]", { status: 200 })
        : new Response("err", { status: 500 }),
    );
    const geocoder = new Geocoder({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      cache: memoryGeocodeCache(),
      minDelayMs: 1,
    });
    await expect(geocoder.geocode("nowhere xx")).resolves.toBeNull();
    await expect(geocoder.geocode("boom")).resolves.toBeNull();
  });

  it("throttles nominatim lookups", async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify([{ lat: "1", lon: "2" }]), { status: 200 }),
    );
    let now = 5000;
    const sleeps: number[] = [];
    const geocoder = new Geocoder({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      cache: memoryGeocodeCache(),
      minDelayMs: 1000,
      now: () => now,
      sleep: (ms: number) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await geocoder.geocode("first place");
    await geocoder.geocode("second place");
    expect(sleeps).toEqual([1000]);
  });
});
