// Amazon Product Advertising API 5.0 client (Feature B). Signs requests with
// AWS Signature v4 in the browser via crypto.subtle — no server, no secret in
// the manifest (the friend pastes keys into the dashboard). Extension
// host-permissions for webservices.amazon.* let us POST without CORS trouble.
//
// The SigV4 core (sigv4Headers) is separated out and unit-tested against AWS's
// published "get-vanilla" reference vector so we know the signing is correct.

import type { ApiKeys, ReplacementCandidate } from "./types";

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(msg: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(msg)));
}

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

async function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode("AWS4" + secret), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface Sigv4Input {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  headers: Record<string, string>; // must include host & x-amz-date
  payload: string;
  accessKey: string;
  secretKey: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
  dateStamp: string; // YYYYMMDD
}

/** Compute the SigV4 Authorization header value (and echo signed headers). */
export async function sigv4Headers(
  input: Sigv4Input
): Promise<{ authorization: string; signedHeaders: string }> {
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) {
    lowerHeaders[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  }
  const sortedKeys = Object.keys(lowerHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${lowerHeaders[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const payloadHash = await sha256Hex(input.payload);

  const canonicalRequest = [
    input.method,
    input.path,
    "", // canonical query string (none)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey(input.secretKey, input.dateStamp, input.region, input.service);
  const signature = toHex(await hmac(key, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signedHeaders };
}

// ── Marketplace → PA-API host / region ──────────────────────────────────────
interface Marketplace {
  host: string;
  region: string;
  site: string;
}
const MARKETPLACES: Record<string, Marketplace> = {
  "amazon.com": { host: "webservices.amazon.com", region: "us-east-1", site: "www.amazon.com" },
  "amazon.co.uk": { host: "webservices.amazon.co.uk", region: "eu-west-1", site: "www.amazon.co.uk" },
  "amazon.de": { host: "webservices.amazon.de", region: "eu-west-1", site: "www.amazon.de" },
  "amazon.fr": { host: "webservices.amazon.fr", region: "eu-west-1", site: "www.amazon.fr" },
  "amazon.it": { host: "webservices.amazon.it", region: "eu-west-1", site: "www.amazon.it" },
  "amazon.es": { host: "webservices.amazon.es", region: "eu-west-1", site: "www.amazon.es" },
  "amazon.in": { host: "webservices.amazon.in", region: "eu-west-1", site: "www.amazon.in" },
  "amazon.ca": { host: "webservices.amazon.ca", region: "us-east-1", site: "www.amazon.ca" },
  "amazon.com.au": { host: "webservices.amazon.com.au", region: "us-west-2", site: "www.amazon.com.au" },
  "amazon.co.jp": { host: "webservices.amazon.co.jp", region: "us-west-2", site: "www.amazon.co.jp" },
};

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface SearchDeps {
  fetcher?: Fetcher;
  amzDate?: string; // injectable for tests
}

export class PaapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaapiError";
  }
}

function amzDateNow(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** Build the tagged product URL OURSELVES from a PA-API ASIN (never the LLM). */
export function taggedUrl(site: string, asin: string, partnerTag: string): string {
  return `https://${site}/dp/${asin}?tag=${encodeURIComponent(partnerTag)}`;
}

/** SearchItems → real candidates. Throws PaapiError on API/eligibility errors. */
export async function searchItems(
  args: { keywords: string; marketplace: string; itemCount?: number },
  keys: ApiKeys,
  deps: SearchDeps = {}
): Promise<ReplacementCandidate[]> {
  const mp = MARKETPLACES[args.marketplace] ?? MARKETPLACES["amazon.com"];
  const region = keys.paapiRegion?.trim() || mp.region;
  const service = "ProductAdvertisingAPI";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems";
  const path = "/paapi5/searchitems";
  const amzDate = deps.amzDate ?? amzDateNow();
  const dateStamp = amzDate.slice(0, 8);

  const payload = JSON.stringify({
    Keywords: args.keywords,
    SearchIndex: "All",
    ItemCount: args.itemCount ?? 5,
    PartnerTag: keys.paapiPartnerTag,
    PartnerType: "Associates",
    Marketplace: mp.site,
    Resources: ["Images.Primary.Medium", "ItemInfo.Title", "Offers.Listings.Price"],
  });

  const headers: Record<string, string> = {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host: mp.host,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };

  const { authorization } = await sigv4Headers({
    method: "POST",
    host: mp.host,
    path,
    region,
    service,
    headers,
    payload,
    accessKey: keys.paapiAccessKey,
    secretKey: keys.paapiSecretKey,
    amzDate,
    dateStamp,
  });

  const fetcher = deps.fetcher ?? fetch;
  const res = await fetcher(`https://${mp.host}${path}`, {
    method: "POST",
    headers: { ...headers, Authorization: authorization },
    body: payload,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { Errors?: { Message?: string }[] })?.Errors?.[0]?.Message ||
      `PA-API request failed (${res.status})`;
    throw new PaapiError(msg);
  }

  const items = (data as {
    SearchResult?: {
      Items?: {
        ASIN?: string;
        ItemInfo?: { Title?: { DisplayValue?: string } };
        Images?: { Primary?: { Medium?: { URL?: string } } };
        Offers?: { Listings?: { Price?: { DisplayAmount?: string } }[] };
      }[];
    };
  }).SearchResult?.Items ?? [];

  return items
    .filter((it) => it.ASIN)
    .map((it) => ({
      asin: it.ASIN!,
      title: it.ItemInfo?.Title?.DisplayValue ?? it.ASIN!,
      url: taggedUrl(mp.site, it.ASIN!, keys.paapiPartnerTag),
      image: it.Images?.Primary?.Medium?.URL,
      price: it.Offers?.Listings?.[0]?.Price?.DisplayAmount,
    }));
}
