import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EventsService } from './events/events.service';
import { Event } from './events/event.entity';
import { User } from './users/user.entity';

// describe('AppController', () => {
//   let app: TestingModule;

//   beforeAll(async () => {
//     app = await Test.createTestingModule({
//       controllers: [AppController],
//       providers: [AppService],
//     }).compile();
//   });

//   describe('getHello', () => {
//     it('should return "Hello World!"', () => {
//       const appController = app.get(AppController);
//       expect(appController.getHello()).toBe('Hello World!');
//     });
//   });
// });

describe('EventsService', () => {
  let moduleRef: TestingModule;
  let service: EventsService;
  let eventRepo: jest.Mocked<Repository<Event>>;
  let userRepo: jest.Mocked<Repository<User>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getRepositoryToken(Event),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(EventsService);
    eventRepo = moduleRef.get(getRepositoryToken(Event));
    userRepo = moduleRef.get(getRepositoryToken(User));
  });

  describe('create', () => {
    it('should attach invitees and return the saved event with invitees', async () => {
      // Arrange
      const aliceId = '1e24c2f8-28d8-4059-aa6f-61d32ee59e02';
      const dto = {
        title: 'Alice Event 1',
        description: 'Seeded',
        status: 'TODO',
        startTime: '2025-08-29T14:00:00Z',
        endTime: '2025-08-29T15:00:00Z',
        invitees: [{ id: aliceId }],
      };

      const aliceUser: User = { id: aliceId } as User;

      // Mock user lookup by ids
      userRepo.find.mockResolvedValue([aliceUser]);

      // Mock create/save
      const createdEvent: Event = {
        id: 'event-uuid-1',
        title: dto.title,
        description: dto.description,
        status: dto.status as any,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        createdAt: new Date(),
        updatedAt: new Date(),
        invitees: [aliceUser],
      } as Event;

      eventRepo.create.mockReturnValue(createdEvent);
      eventRepo.save.mockResolvedValue({ ...createdEvent });

      // After save, service re-reads with relations
      eventRepo.findOne.mockResolvedValue({ ...createdEvent });

      // Act
      const result = await service.create(dto as any);

      // Assert: users were looked up properly
      // expect(userRepo.find).toHaveBeenCalledWith({
      //   where: { id: In([aliceId]) },
      // });

      // Assert: event was created with invitees
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: dto.title,
          description: dto.description,
          status: dto.status,
          invitees: [aliceUser],
        }),
      );

      // Assert: saved and returned with invitees populated
      expect(eventRepo.save).toHaveBeenCalledWith(createdEvent);
      expect(eventRepo.findOne).toHaveBeenCalledWith({
        where: { id: createdEvent.id },
        relations: ['invitees'],
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'event-uuid-1',
          title: dto.title,
          invitees: [expect.objectContaining({ id: aliceId })],
        }),
      );
    });
  });
});
