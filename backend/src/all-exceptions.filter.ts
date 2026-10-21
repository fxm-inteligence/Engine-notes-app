import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { AbstractHttpAdapter, BaseExceptionFilter } from "@nestjs/core";

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly adapter: AbstractHttpAdapter) {
    super(adapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    console.error(exception);
    this.adapter.reply(
      host.switchToHttp().getResponse(),
      { error: { statusCode: 500, message: "Internal Server Error" } },
      500,
    );
  }
}
