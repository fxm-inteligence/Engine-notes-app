import { TOTAL_COUNT_HEADER, parseListQuery, withNamedQuery } from "../list-query";
import { AdminKeyGuard } from "./admin-key.guard";
import { CreateNoteRequestDto } from "./dto/create-note-request.dto";
import { PatchNoteRequestDto } from "./dto/patch-note-request.dto";
import { UpdateNoteRequestDto } from "./dto/update-note-request.dto";
import { NoteService } from "./note-service.service";
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Response } from "express";

@ApiTags("NoteService")
@Controller()
export class NoteServiceController {
  constructor(private readonly noteService: NoteService) {}

  @Get("/notes")
  async listNotes(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const page = await this.noteService.listNotes(parseListQuery(withNamedQuery(query, { "pinned": { "pinned": "true", "sort": "-createdAt" }, "latest": { "sort": "-createdAt", "limit": "10" } })));
    response.setHeader(TOTAL_COUNT_HEADER, page.total);
    return page.items;
  }

  @Get("/notes/:id")
  getNote(@Param("id") id: string) {
    return this.noteService.getNote(id);
  }

  @Post("/notes")
  createNote(@Body() dto: CreateNoteRequestDto) {
    return this.noteService.createNote(dto);
  }

  @UseGuards(AdminKeyGuard)
  @Put("/notes/:id")
  updateNote(@Param("id") id: string, @Body() dto: UpdateNoteRequestDto) {
    return this.noteService.updateNote(id, dto);
  }

  @UseGuards(AdminKeyGuard)
  @Patch("/notes/:id")
  patchNote(@Param("id") id: string, @Body() dto: PatchNoteRequestDto) {
    return this.noteService.patchNote(id, dto);
  }

  @UseGuards(AdminKeyGuard)
  @Delete("/notes/:id")
  deleteNote(@Param("id") id: string) {
    return this.noteService.deleteNote(id);
  }
}
