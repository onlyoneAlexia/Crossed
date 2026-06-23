// End-to-end: two browser users (Alice, Bob) join, like each other, and match —
// real in-browser Groth16 proofs + real testnet contract calls.
import { chromium } from "playwright";

const URL = "http://127.0.0.1:5173/";
const errors = [];

async function newUser(browser, handle) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${handle}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${handle}] PAGEERROR ${e.message}`));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input", { timeout: 30000 });
  await page.fill("input", handle);
  return { ctx, page, handle };
}
const logText = (page) => page.$eval("pre.log", (el) => el.textContent || "").catch(() => "");
async function waitLog(u, substr, ms = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await logText(u.page);
    if (t.includes(substr)) return true;
    await u.page.waitForTimeout(1500);
  }
  throw new Error(`[${u.handle}] timeout waiting for log: "${substr}"\n--- log ---\n${await logText(u.page)}`);
}
const clickText = (u, text) => u.page.click(`button:has-text("${text}")`);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const alice = await newUser(browser, "alice");
    const bob = await newUser(browser, "bob");

    console.log("STEP join alice"); await clickText(alice, "Join Crossed"); await waitLog(alice, "joined as");
    console.log("STEP join bob");   await clickText(bob, "Join Crossed");   await waitLog(bob, "joined as");

    console.log("STEP alice refresh+like");
    await clickText(alice, "Refresh"); await alice.page.waitForTimeout(1500);
    await alice.page.click('li:has-text("bob") button:has-text("Like")');
    await waitLog(alice, "liked bob");

    console.log("STEP bob refresh+like");
    await clickText(bob, "Refresh"); await bob.page.waitForTimeout(1500);
    await bob.page.click('li:has-text("alice") button:has-text("Like")');
    await waitLog(bob, "liked alice");

    console.log("STEP alice check matches"); await clickText(alice, "Check for matches");
    try { await waitLog(alice, "It's a Crossed", 180000); }
    catch { console.log("alice no match yet, trying bob"); }
    console.log("STEP bob check matches"); await clickText(bob, "Check for matches");
    await waitLog(bob, "It's a Crossed", 180000).catch(() => {});

    const aOk = (await logText(alice.page)).includes("It's a Crossed");
    const bOk = (await logText(bob.page)).includes("It's a Crossed");
    console.log("\n=== RESULT ===");
    console.log("alice matched:", aOk, "| bob matched:", bOk);
    console.log(aOk || bOk ? "✅ MVP END-TO-END MATCH SUCCEEDED" : "❌ no match detected");
    if (errors.length) console.log("\nconsole errors:\n" + errors.slice(0, 20).join("\n"));
    process.exit(aOk || bOk ? 0 : 1);
  } catch (e) {
    console.log("❌ E2E ERROR:", e.message);
    if (errors.length) console.log("\nconsole errors:\n" + errors.slice(0, 20).join("\n"));
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
