"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData, useApiWrite } from "@/lib/use-api-data";
import { motion } from "framer-motion";
import { FormEvent } from "react";

export default function HomePage() {
  const notes = useApiData<Record<string, unknown>[]>("/notes?sort=-createdAt");
  const addNote = useApiWrite("/notes", "POST");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = {
      "pinned": data.get("pinned") === "on",
      "body": String(data.get("body") ?? ""),
      "title": String(data.get("title") ?? ""),
    };
    try {
      await addNote.run(values);
      await notes.reload();
      form.reset();
    } catch {
      // Surfaced through the Write Block's `error`.
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <form onSubmit={onSubmit}><Table><TableHeader><TableRow><TableHead>title</TableHead><TableHead>body</TableHead><TableHead>pinned</TableHead></TableRow></TableHeader><TableBody>{notes.loading ? (<TableRow><TableCell>Loading…</TableCell></TableRow>) : notes.error ? (<TableRow><TableCell>{notes.error.message}</TableCell></TableRow>) : (notes.data ?? []).length === 0 ? (<TableRow><TableCell>No records yet.</TableCell></TableRow>) : null}{(notes.data ?? []).map((row, index) => (<TableRow key={index}>{["title", "body", "pinned"].map((key) => (<TableCell key={key}>{String(row[key] ?? "")}</TableCell>))}</TableRow>))}</TableBody></Table><label className="flex flex-col gap-1 text-sm"><span>title</span><Input name="title" /></label><label className="flex flex-col gap-1 text-sm"><span>body</span><textarea className="rounded-md border px-3 py-2" name="body"></textarea></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border" name="pinned" />pinned</label><Button type="submit">Add</Button>{addNote.error && <p className="text-sm text-red-500">{addNote.error.message}</p>}</form>
    </motion.div>
  );
}
