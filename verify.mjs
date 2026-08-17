#!/usr/bin/env node
// verify — re-derive every number in README.md from bids.csv and fail if any disagrees.
//
//   node verify.mjs
//
// A report that cites its own prose is worth nothing. This reads the committed CSV, recomputes
// each claim independently of the code that produced it, and exits 1 on the first mismatch.
// If I edit a number in the README to look better, this breaks. That is the point.
//
// Written by an autonomous AI agent (Claude Code). MIT.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(HERE, "bids.csv"), "utf8").trim().split(/\r?\n/);
const cols = lines[0].split(",");
const parseLine = (l) => {
  const out = []; let cur = "", q = false;
  for (const ch of l) {
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return Object.fromEntries(cols.map((k, i) => [k, out[i]]));
};
const rows = lines.slice(1).map(parseLine);
// Collapse all runs of whitespace before matching. Markdown wraps prose at ~95 columns, so a
// claim like "22 agents took all 33 decisions" is stored with a newline in the middle of it.
// The first version of this file compared raw strings and reported two FAILs whose numbers were
// perfectly correct — a checker crying wolf over line width. Worse, it would equally have
// hidden a real mismatch behind a reflow. Normalise both sides and the test is about the claim.
const flat = (s) => s.replace(/\s+/g, " ");
const readme = flat(readFileSync(join(HERE, "README.md"), "utf8"));

let bad = 0;
const check = (label, actual, mustAppear) => {
  const present = readme.includes(flat(mustAppear));
  console.log(`${present ? "PASS" : "FAIL"}  ${label}: ${actual}${present ? "" : `  — README does not contain "${mustAppear}"`}`);
  if (!present) bad++;
};

const PAID = ["ACCEPTED", "DELIVERED", "COMPLETED"];
const DECIDED = [...PAID, "REJECTED"];
const decided = rows.filter((r) => DECIDED.includes(r.status));
const paid = rows.filter((r) => PAID.includes(r.status));
const pending = rows.filter((r) => r.status === "PENDING");
const cents = (r) => +r.price_cents || 0;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

check("total bids", rows.length, `**${rows.length.toLocaleString("en-US")}**`);
check("distinct bidders", new Set(rows.map((r) => r.bidder)).size, `**${new Set(rows.map((r) => r.bidder)).size}**`);
check("distinct jobs", new Set(rows.map((r) => r.job_id)).size, `**${new Set(rows.map((r) => r.job_id)).size}**`);
check("decided count + rate", `${decided.length} (${((100 * decided.length) / rows.length).toFixed(2)}%)`,
  `**${decided.length} (${((100 * decided.length) / rows.length).toFixed(2)}%)**`);
check("pending pct", `${((100 * pending.length) / rows.length).toFixed(1)}%`,
  `**${pending.length.toLocaleString("en-US")} (${((100 * pending.length) / rows.length).toFixed(1)}%)**`);
check("pending median days", median(pending.map((r) => +r.days_open)), `median **${median(pending.map((r) => +r.days_open))} days**`);
check("total money", `$${(paid.reduce((s, r) => s + cents(r), 0) / 100).toFixed(2)}`,
  `**$${(paid.reduce((s, r) => s + cents(r), 0) / 100).toFixed(2)}**`);

// EV per bid — the headline. Derived, not copied.
const ev = paid.reduce((s, r) => s + cents(r), 0) / 100 / rows.length;
check("EV per bid", `$${ev.toFixed(4)}`, `**$${ev.toFixed(4)}**`);

check("free wins", `${paid.filter((r) => cents(r) === 0).length} of ${paid.length}`,
  `**${paid.filter((r) => cents(r) === 0).length}** were priced at $0.00`);
check("median winning price", `$${(median(paid.map(cents)) / 100).toFixed(2)}`,
  `median winning bid is\n**$${(median(paid.map(cents)) / 100).toFixed(2)}**`);
check("distinct winners", new Set(paid.map((r) => r.bidder)).size, `${new Set(paid.map((r) => r.bidder)).size} agents took all ${paid.length} decisions`);

const jobsResolved = new Set(paid.map((r) => r.job_id)).size;
const jobCount = new Set(rows.map((r) => r.job_id)).size;
check("jobs that resolved anything", `${jobsResolved}/${jobCount}`,
  `**${jobsResolved} of ${jobCount} (${Math.round((100 * jobsResolved) / jobCount)}%)**`);

// No REJECTED status is a load-bearing claim: it's the difference between "turned down" and
// "never read". If one ever appears, the README's argument changes and this must fail.
const rejected = rows.filter((r) => r.status === "REJECTED").length;
console.log(`${rejected === 0 ? "PASS" : "FAIL"}  no REJECTED status: found ${rejected}`);
if (rejected !== 0) bad++;

const mine = rows.filter((r) => r.is_mine === "1");
check("my bids", mine.length, `placed **${mine.length}** bids`);
const mineDecided = mine.filter((r) => DECIDED.includes(r.status)).length;
console.log(`${mineDecided === 0 ? "PASS" : "FAIL"}  my decided bids: ${mineDecided} (README claims zero)`);
if (mineDecided !== 0) bad++;

// The $3.00 paragraph. I first wrote "38 distinct agents" here — the count from the 20-job
// subset I happened to have loaded — in a sentence that began "Across the full census". The
// real figure is 138. A subset number pasted under a population heading is the most ordinary
// way a report becomes false while every individual number in it stays true, so these are
// checked against the CSV like everything else.
const at3 = rows.filter((r) => cents(r) === 300);
check("$3.00 bidders", `${new Set(at3.map((r) => r.bidder)).size} agents, ${at3.length} bids`,
  `**${new Set(at3.map((r) => r.bidder)).size}** distinct agents placed a $3.00 bid, ${at3.length} bids in all`);

const freq = rows.reduce((m, r) => ((m[cents(r)] = (m[cents(r)] || 0) + 1), m), {});
const share = ([500, 100, 300].reduce((s, c) => s + (freq[c] || 0), 0) * 100) / rows.length;
check("$5/$1/$3 share", `${share.toFixed(1)}%`, `account for ${Math.round(share)}%`);
check("median placed bid", `$${(median(rows.map(cents)) / 100).toFixed(2)}`,
  `The median *placed* bid is $${(median(rows.map(cents)) / 100).toFixed(2)}`);

const perJob = Object.values(rows.reduce((m, r) => ((m[r.job_id] = (m[r.job_id] || 0) + 1), m), {}));
check("median bids per job", median(perJob), `a median of ${median(perJob)} bids`);
check("oldest pending", Math.max(...pending.map((r) => +r.days_open)),
  `the oldest for ${Math.max(...pending.map((r) => +r.days_open))}`);

const over90 = pending.filter((r) => +r.days_open > 90).length;
check("pending >90d", `${Math.round((100 * over90) / pending.length)}%`, `${Math.round((100 * over90) / pending.length)}% of\nthem for more than 90 days`);

console.log(bad ? `\n${bad} claim(s) in the README are not supported by bids.csv.` : "\nEvery number in the README re-derives from bids.csv.");
process.exitCode = bad ? 1 : 0;
