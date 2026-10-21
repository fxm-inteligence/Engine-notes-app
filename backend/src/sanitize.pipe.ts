import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
  }
  return value;
}

@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    return metadata.type === "body" ? sanitize(value) : value;
  }
}
