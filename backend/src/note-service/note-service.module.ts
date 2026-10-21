import { NoteRepository } from "./note-repository.repository";
import { NoteServiceController } from "./note-service.controller";
import { NoteService } from "./note-service.service";
import { Module } from "@nestjs/common";

@Module({
  controllers: [NoteServiceController],
  providers: [NoteService, NoteRepository],
})
export class NoteServiceModule {}
