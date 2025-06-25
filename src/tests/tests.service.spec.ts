import { Test, TestingModule } from '@nestjs/testing';
import { TestsService } from './tests.service';
import { TestsModule } from './tests.module';

describe('TestsService', () => {
  let service: TestsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestsModule],
    }).compile();

    service = module.get<TestsService>(TestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
