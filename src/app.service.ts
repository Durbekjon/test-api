import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {} 
  getHello(): string {
    return 'Hello World!';
  }

  async cleanupDb() {
    await this.prisma.testSubmission.deleteMany();
    await this.prisma.testVariant.deleteMany();
    await this.prisma.testSettings.deleteMany();
    await this.prisma.answer.deleteMany();
    await this.prisma.question.deleteMany();
    await this.prisma.test.deleteMany();
    await this.prisma.user.deleteMany();
    return {status: 'ok'};
  }
}
