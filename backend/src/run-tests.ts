import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

const extension = extname(__filename);

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(`.test${extension}`) ? [path] : [];
  });
}

for (const file of testFiles(__dirname)) require(file);
