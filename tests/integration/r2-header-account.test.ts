// Round 2: the public header's account slot and the sign-out return path.
//   * HeaderAccount renders nothing for a signed-out visitor (no account data in the response), and the account
//     menu, with a name and email from the verified Auth user, for a signed-in one;
//   * /auth/signout lands on a safe same-origin `next` (the public header sends "/"), never off-site, and still
//     defaults to the sign-in page.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import * as signout from "../../app/auth/signout/route";
import { HeaderAccount } from "../../components/layout/header-account";
import { authCalls, resetPlatform, signInAs, SITE_URL } from "./support/platform";

type Element = { props: { name: string; email: string | null } } | null;

const post = (body?: Record<string, string>) => {
  const url = `${SITE_URL}/auth/signout`;
  const init: RequestInit = { method: "POST" };
  if (body) init.body = new URLSearchParams(body);
  return signout.POST(Object.assign(new Request(url, init), { nextUrl: new URL(url) }) as never);
};

describe("public header account slot", () => {
  beforeEach(() => resetPlatform());

  it("signed out: renders nothing at all", async () => {
    assert.equal(await HeaderAccount(), null);
    assert.ok(authCalls().some((c) => c.name === "getUser"), "the session is checked with the Auth server");
  });

  it("signed in: the account menu with the verified user's details only", async () => {
    signInAs("0b6a1c1e-1f00-4c3b-9d7a-0000000000e5", "pat.lee@example.test");
    const el = (await HeaderAccount()) as Element;
    assert.ok(el);
    assert.equal(el.props.email, "pat.lee@example.test");
    assert.equal(el.props.name, "pat.lee", "no profile name in the auth metadata: the email's local part");
  });
});

describe("/auth/signout return path", () => {
  beforeEach(() => resetPlatform());

  it("signs out, then lands on a safe same-origin next", async () => {
    const res = await post({ next: "/" });
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get("location")!).pathname, "/");
    assert.ok(authCalls().some((c) => c.name === "signOut"));
  });

  it("an unsafe next is ignored (open-redirect guard); no body still goes to the sign-in page", async () => {
    for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
      const res = await post({ next });
      const to = new URL(res.headers.get("location")!);
      assert.equal(to.origin, SITE_URL, next);
      assert.equal(to.pathname, "/login", next);
    }
    const res = await post();
    assert.equal(new URL(res.headers.get("location")!).pathname, "/login");
  });
});
