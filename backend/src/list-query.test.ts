import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseListQuery } from "./list-query";

test("a request without parameters asks for every row in the database's order", () => {
  assert.deepEqual(parseListQuery(undefined), {
    search: undefined,
    sort: undefined,
    offset: 0,
    limit: undefined,
  });
  assert.deepEqual(parseListQuery({}), parseListQuery(undefined));
});

test("q becomes the text to search for", () => {
  assert.equal(parseListQuery({ q: "ALI" }).search, "ALI");
  assert.equal(parseListQuery({ q: "" }).search, undefined);
});

test("sort names a field, a leading minus makes it descending", () => {
  assert.deepEqual(parseListQuery({ sort: "age" }).sort, { field: "age", descending: false });
  assert.deepEqual(parseListQuery({ sort: "-age" }).sort, { field: "age", descending: true });
  assert.equal(parseListQuery({ sort: "" }).sort, undefined);
  assert.equal(parseListQuery({ sort: "-" }).sort, undefined);
});

test("offset and limit are counts, an invalid one is ignored", () => {
  const page = parseListQuery({ offset: "1", limit: "2" });
  assert.equal(page.offset, 1);
  assert.equal(page.limit, 2);
  const invalid = parseListQuery({ limit: "abc", offset: "-1" });
  assert.equal(invalid.offset, 0);
  assert.equal(invalid.limit, undefined);
});
