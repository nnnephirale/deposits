#!/usr/bin/env node
// Seed SSaved's collections into R2 from the GitHub backup repo.
//
// The backups hold every card's link, notes, username, OCR suggestions, folder and ordering
// — everything except the screenshots themselves, which carry only an `imagePath` reference.
// That means the whole of SSaved except its images can move off Supabase today, without
// touching the quota that is currently blocking it.
//
//   node seed-ssaved.mjs --backups ../../ssaved-backups --worker https://deposits.x.workers.dev --secret ...
//
// Idempotent: re-running overwrites each collection document with the same content.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const { backups, worker, secret, dry } = args;
if (!backups || (!dry && (!worker || !secret))) {
  console.error("usage: node seed-ssaved.mjs --backups <path to ssaved-backups> --worker <url> --secret <secret>");
  console.error("       add --dry 1 to inspect what would be written without sending it");
  process.exit(1);
}

// Each collection has one file per backup date; the newest wins. Dates are in the filename
// AND in exportedAt — trust exportedAt, since a file can be rewritten within a day.
async function newestPerCollection(root) {
  const out = new Map();
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
    for (const f of await readdir(join(root, dir.name))) {
      if (!f.endsWith(".json")) continue;
      const doc = JSON.parse(await readFile(join(root, dir.name, f), "utf8"));
      const id = doc.collectionId || dir.name;
      const when = doc.exportedAt || f.replace(".json", "");
      const prev = out.get(id);
      if (!prev || when > prev.when) out.set(id, { when, doc });
    }
  }
  return out;
}

const collections = await newestPerCollection(backups);
if (!collections.size) {
  console.error(`no backup files found under ${backups}`);
  process.exit(1);
}

let total = 0, totalImages = 0;
for (const [id, { when, doc }] of [...collections].sort()) {
  const cards = (doc.cards || []).filter(c => !c.deletedAt);
  const folders = doc.folders || [];
  const images = new Set(cards.map(c => c.imagePath).filter(Boolean));
  total += cards.length;
  totalImages += images.size;

  console.log(`${id.padEnd(12)} ${when.slice(0, 10)}  ${String(cards.length).padStart(3)} cards  ` +
              `${String(folders.length).padStart(2)} folders  ${String(images.size).padStart(3)} images`);

  if (dry) continue;

  const res = await fetch(`${worker.replace(/\/+$/, "")}/s/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { authorization: "Bearer " + secret, "content-type": "application/json" },
    body: JSON.stringify({ cards, folders })
  });
  if (!res.ok) {
    console.error(`  -> FAILED: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`  -> stored (${(await res.json()).cards} cards)`);
}

console.log(`\n${total} cards across ${collections.size} collections.`);
console.log(`${totalImages} screenshots still to come — those live only in Supabase Storage,`);
console.log(`and need its egress quota to reset before they can be copied across.`);
