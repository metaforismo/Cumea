// Child-process integration-test fixture. Production keeps a fixed provider
// origin; this preload intercepts only that origin before the real server is
// imported, so config-route tests never depend on external network access.
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://ascii.dev/api/box/v1/boxes") {
    const authorization = new Headers(init?.headers).get("authorization");
    if (authorization === "Bearer tok_secret_value") {
      return new Response(JSON.stringify({ boxes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "fixture body must stay private" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
};
