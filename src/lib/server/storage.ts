// Local filesystem storage behind a tiny interface (swap for S3/R2 in production).
import fs from "node:fs";
import path from "node:path";

export const STORAGE_ROOT = path.resolve(process.env.PARTART_STORAGE_DIR || "./storage");

function safeJoin(rel: string) {
  const p = path.resolve(STORAGE_ROOT, rel);
  if (!p.startsWith(STORAGE_ROOT)) throw new Error("Invalid storage path");
  return p;
}

export const storage = {
  async put(rel: string, data: Buffer | string) {
    const p = safeJoin(rel);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, data);
    return rel.split(path.sep).join("/");
  },
  async get(rel: string) {
    return fs.promises.readFile(safeJoin(rel));
  },
  getSync(rel: string) {
    return fs.readFileSync(safeJoin(rel));
  },
  exists(rel: string) {
    return fs.existsSync(safeJoin(rel));
  },
  async remove(rel: string) {
    await fs.promises.rm(safeJoin(rel), { recursive: true, force: true });
  },
};
