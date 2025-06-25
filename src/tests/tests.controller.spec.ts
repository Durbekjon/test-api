import { Test, TestingModule } from '@nestjs/testing';
import { TestsController } from './tests.controller';
import { TestsModule } from './tests.module';

describe('TestsController', () => {
  let controller: TestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestsModule],
    }).compile();

    controller = module.get<TestsController>(TestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
