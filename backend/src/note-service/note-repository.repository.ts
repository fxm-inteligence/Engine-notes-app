import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { ambient } from "../transaction-scope";
import { readFilters, type FilterKind, type ListQuery, type Page } from "../list-query";

export interface NoteRecord {
  id: string;
  title: string;
  body?: string;
  pinned?: boolean;
  createdAt?: Date;
}

function searchWhere(search: string | undefined) {
  if (search === undefined) return undefined;
  return {
    OR: [
      { title: { contains: search, mode: "insensitive" as const } },
      { body: { contains: search, mode: "insensitive" as const } },
    ],
  };
}

const FILTER_COLUMNS = new Map<string, FilterKind>([
  ["id", "uuid"],
  ["title", "text"],
  ["pinned", "boolean"],
  ["createdAt", "datetime"],
]);

function listWhere(query: ListQuery) {
  const conditions: Record<string, unknown>[] = readFilters(query.filters, FILTER_COLUMNS).map(
    ({ field, operator, value }) =>
      value === undefined
        ? { id: { in: [] } }
        : { [field]: operator === "equals" ? value : { [operator]: value } },
  );
  const search = searchWhere(query.search);
  if (search) conditions.push(search);
  return { AND: conditions };
}

function orderBy(sort: ListQuery["sort"]) {
  const direction = sort?.descending ? ("desc" as const) : ("asc" as const);
  switch (sort?.field) {
    case "id":
      return [{ id: direction }];
    case "title":
      return [{ title: direction }, { id: "asc" as const }];
    case "body":
      return [{ body: direction }, { id: "asc" as const }];
    case "pinned":
      return [{ pinned: direction }, { id: "asc" as const }];
    case "createdAt":
      return [{ createdAt: direction }, { id: "asc" as const }];
    default:
      return [{ id: "asc" as const }];
  }
}

@Injectable()
export class NoteRepository {
  private readonly prisma = ambient(new PrismaClient());

  findPage(query: ListQuery): Promise<Page<NoteRecord>> {
    return Promise.all([
      this.prisma.note.findMany({ where: listWhere(query), orderBy: orderBy(query.sort), skip: query.offset, take: query.limit }),
      this.prisma.note.count({ where: listWhere(query) }),
    ]).then(([rows, total]) => ({ items: rows, total }));
  }

  findById(id: NoteRecord["id"]): Promise<NoteRecord | null> {
    return this.prisma.note.findUnique({ where: { id } });
  }

  findByField(field: keyof NoteRecord & string, value: unknown): Promise<NoteRecord | null> {
    return this.prisma.note.findFirst({ where: { [field]: value } });
  }

  create(data: Omit<NoteRecord, "id">): Promise<NoteRecord> {
    return this.prisma.note.create({ data });
  }

  update(id: NoteRecord["id"], data: Partial<Omit<NoteRecord, "id">>): Promise<NoteRecord> {
    return this.prisma.note.update({ where: { id }, data });
  }

  remove(id: NoteRecord["id"]): Promise<NoteRecord> {
    return this.prisma.note.delete({ where: { id } });
  }
}
