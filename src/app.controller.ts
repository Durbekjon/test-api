import { Controller, Delete, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('ping')
  getPing() {
    return { message: 'pong' };
  }

  @Get('health')
  getHealth() {
    return { status: 'ok' };
  }

  @Delete('cleanup-db')
  async cleanupDb() {
    return this.appService.cleanupDb();
  }
}
