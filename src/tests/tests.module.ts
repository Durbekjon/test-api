import { Module } from '@nestjs/common';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [MulterModule.register(), PrismaModule],
  controllers: [TestsController],
  providers: [TestsService]
})
export class TestsModule {}
