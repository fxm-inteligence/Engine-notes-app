import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { MessageMappingProperties } from "@nestjs/websockets/gateway-metadata-explorer";
import { WsAdapter } from "@nestjs/platform-ws";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { EMPTY, Observable } from "rxjs";
import helmet from "helmet";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { AppModule } from "./app.module";
import { SanitizePipe } from "./sanitize.pipe";

// Nest's `ws` adapter routes an incoming message by its `event` field; the
// protocol every other Adapter and the generated frontend speak is
// `{"route", "data"}`, so the adapter reads `route` instead.
class RouteWsAdapter extends WsAdapter {
  bindMessageHandler(
    buffer: { data: string },
    handlers: Map<string, MessageMappingProperties>,
    transform: (data: any) => Observable<any>,
  ): Observable<any> {
    try {
      const message = JSON.parse(buffer.data) as { route?: string; data?: unknown };
      const handler = handlers.get(message.route ?? "");
      return handler ? transform(handler.callback(message.data, message.route)) : EMPTY;
    } catch {
      return EMPTY;
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Nest's default gateway transport is Socket.IO, which needs the `socket.io`
  // package this catalogue never installs; `ws` matches the raw-JSON-over-`ws`
  // protocol every other Adapter's own WebSocket transport already speaks.
  app.useWebSocketAdapter(new RouteWsAdapter(app));
  app.use(helmet());
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(",") ?? false, credentials: true, exposedHeaders: ["X-Total-Count"] });
  app.useGlobalPipes(new SanitizePipe(), new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
  app.getHttpAdapter().get("/health", (_req: unknown, res: { json(body: unknown): void }) =>
    res.json({ status: "ok" }),
  );

  const swaggerConfig = new DocumentBuilder().setTitle("Backend API").setVersion("1.0.0").build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
