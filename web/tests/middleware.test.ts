import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware, AUTH_COOKIE } from "../src/middleware";

function createRequest(url: string, cookieValue?: string): NextRequest {
  const req = new NextRequest(url);
  if (cookieValue !== undefined) {
    req.cookies.set(AUTH_COOKIE, cookieValue);
  }
  return req;
}

test("unauthenticated user accessing the MainPage route '/' can view it publicly without redirection", () => {
  const req = createRequest("https://supplyright.local/");
  const res = middleware(req);

  assert.notEqual(res.status, 307);
  assert.notEqual(res.status, 308);
  assert.equal(res.headers.get("location"), null);
});

test("unauthenticated user navigating from MainPage to other routes is redirected to /auth", () => {
  const routesToTest = [
    { from: "/dashboard", expectedNext: "/dashboard" },
    { from: "/registry?tab=pending", expectedNext: "/registry?tab=pending" },
    { from: "/protection", expectedNext: "/protection" },
    { from: "/production", expectedNext: "/production" },
    { from: "/claims", expectedNext: "/claims" },
    { from: "/provider", expectedNext: "/provider" },
    { from: "/verify", expectedNext: "/verify" },
    { from: "/admin", expectedNext: "/admin" },
    { from: "/supply/1", expectedNext: "/supply/1" },
  ];

  for (const { from, expectedNext } of routesToTest) {
    const req = createRequest(`https://supplyright.local${from}`);
    const res = middleware(req);
    assert.equal(res.status, 307, `Expected ${from} to redirect unauthenticated user`);
    const targetUrl = new URL(res.headers.get("location")!);
    assert.equal(targetUrl.pathname, "/auth");
    assert.equal(targetUrl.searchParams.get("next"), expectedNext);
  }
});

test("authenticated user with valid session preserves original route behavior on MainPage and all routes", () => {
  const routes = ["/", "/dashboard", "/registry", "/protection", "/production", "/claims", "/provider", "/verify", "/admin", "/supply/1"];

  for (const path of routes) {
    const req = createRequest(`https://supplyright.local${path}`, "1");
    const res = middleware(req);
    assert.notEqual(res.status, 307, `Expected authenticated user on ${path} not to be redirected`);
    assert.notEqual(res.status, 308);
    assert.equal(res.headers.get("location"), null);
  }
});

test("authenticated user visiting /auth is redirected away to destination or /dashboard", () => {
  const reqWithoutNext = createRequest("https://supplyright.local/auth", "1");
  const resWithoutNext = middleware(reqWithoutNext);
  assert.equal(resWithoutNext.status, 307);
  const locWithoutNext = new URL(resWithoutNext.headers.get("location")!);
  assert.equal(locWithoutNext.pathname, "/dashboard");

  const reqWithNext = createRequest("https://supplyright.local/auth?next=/registry", "1");
  const resWithNext = middleware(reqWithNext);
  assert.equal(resWithNext.status, 307);
  const locWithNext = new URL(resWithNext.headers.get("location")!);
  assert.equal(locWithNext.pathname, "/registry");
});

test("unauthenticated user can access /auth directly without redirection loop", () => {
  const req = createRequest("https://supplyright.local/auth");
  const res = middleware(req);

  assert.notEqual(res.status, 307);
  assert.notEqual(res.status, 308);
  assert.equal(res.headers.get("location"), null);
});

test("static assets and API routes remain accessible without redirection", () => {
  for (const path of ["/favicon.ico", "/api/config", "/_next/static/chunk.js", "/logo.png"]) {
    const req = createRequest(`https://supplyright.local${path}`);
    const res = middleware(req);
    assert.notEqual(res.status, 307, `Expected ${path} not to redirect`);
    assert.equal(res.headers.get("location"), null);
  }
});
