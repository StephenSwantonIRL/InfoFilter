const request = require("supertest");
const { describe, it, expect } = require("vitest");
const { createApp } = require("../src/app");

describe("app", () => {
  it("returns health status", async () => {
    const app = createApp();
    const response = await request(app).get("/health");
    expect(response.statusCode).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
