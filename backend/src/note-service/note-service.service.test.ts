import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import type { NoteRepository } from "./note-repository.repository";
import { NoteService } from "./note-service.service";

type Row = Record<string, any>;

/** A Repository that keeps its rows in memory, so the Service is tested without a database. */
function setup() {
  const rows = new Map<any, Row>();
  let next = 1;
  const repository = {
    findPage: async () => ({ items: [...rows.values()], total: rows.size }),
    findById: async (id: any) => rows.get(id) ?? null,
    findByField: async (field: string, value: unknown) =>
      [...rows.values()].find((row) => row[field] === value) ?? null,
    create: async (data: Row) => {
      const row = { id: String(next++), ...data };
      rows.set(row.id, row);
      return row;
    },
    update: async (id: any, data: Row) => {
      const row = { ...rows.get(id), ...data };
      rows.set(id, row);
      return row;
    },
    remove: async (id: any) => {
      const row = rows.get(id);
      rows.delete(id);
      return row;
    },
  };
  const service = new NoteService(repository as unknown as NoteRepository);
  return { service: service as any, rows };
}

function sample(): Row {
  return { title: "sample", body: "sample", pinned: true, createdAt: "2024-01-01T00:00:00.000Z" };
}

test("createNote stores the record and answers with its id", async () => {
  const { service, rows } = setup();
  const created = await service.createNote(sample() as never);
  assert.notEqual(created.id, undefined);
  assert.equal(rows.size, 1);
  assert.equal(created.title, sample().title);
});

test("listNotes answers with the stored records and their total", async () => {
  const { service } = setup();
  await service.createNote(sample() as never);
  const page = await service.listNotes({ search: undefined, sort: undefined, offset: 0, limit: undefined });
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
});

test("getNote answers with the stored record", async () => {
  const { service } = setup();
  const created = await service.createNote(sample() as never);
  const found = await service.getNote(created.id);
  assert.equal(found.id, created.id);
});

test("getNote answers 404 for an id that does not exist", async () => {
  const { service } = setup();
  await assert.rejects(() => service.getNote("missing-id"), NotFoundException);
});

test("updateNote changes the stored record", async () => {
  const { service, rows } = setup();
  const created = await service.createNote(sample() as never);
  await service.updateNote(created.id, { title: "updated" } as never);
  assert.equal(rows.get(created.id)?.title, "updated");
});

test("updateNote answers 404 for an id that does not exist", async () => {
  const { service } = setup();
  await assert.rejects(() => service.updateNote("missing-id", { title: "updated" } as never), NotFoundException);
});

test("deleteNote removes the record", async () => {
  const { service, rows } = setup();
  const created = await service.createNote(sample() as never);
  await service.deleteNote(created.id);
  assert.equal(rows.size, 0);
});

test("deleteNote answers 404 for an id that does not exist", async () => {
  const { service } = setup();
  await assert.rejects(() => service.deleteNote("missing-id"), NotFoundException);
});
