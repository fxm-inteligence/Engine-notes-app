import { ListQuery } from "../list-query";
import { withHooks } from "../with-hooks";
import { CreateNoteRequestDto } from "./dto/create-note-request.dto";
import { UpdateNoteRequestDto } from "./dto/update-note-request.dto";
import { NoteRepository } from "./note-repository.repository";
import { hooks } from "./note-service.hooks";
import { Injectable, NotFoundException } from "@nestjs/common";

@Injectable()
export class NoteService {
  constructor(private readonly noteRepository: NoteRepository) {}

  listNotes(query: ListQuery) {
    return this.noteRepository.findPage(query);
  }

  async getNote(id: string) {
    const record = await this.noteRepository.findById(id);
    if (!record) throw new NotFoundException();
    return record;
  }

  createNote(dto: CreateNoteRequestDto) {
    return this.noteRepository.create({ ...dto, createdAt: dto.createdAt === undefined ? undefined : new Date(dto.createdAt) });
  }

  async updateNote(id: string, dto: UpdateNoteRequestDto) {
    const record = await this.noteRepository.findById(id);
    if (!record) throw new NotFoundException();
    return this.noteRepository.update(id, { ...dto, createdAt: dto.createdAt === undefined ? undefined : new Date(dto.createdAt) });
  }

  async deleteNote(id: string) {
    const record = await this.noteRepository.findById(id);
    if (!record) throw new NotFoundException();
    return this.noteRepository.remove(id);
  }
}

withHooks(NoteService.prototype, hooks);
