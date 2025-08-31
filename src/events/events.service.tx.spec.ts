import { Repository } from 'typeorm';
import { EventsService } from './events.service';
import { Event } from './event.entity';
import { User } from '../users/user.entity';
import { EventStatus } from './event-status.enum';
import { NotFoundException } from '@nestjs/common';

type MockedRepo<T> = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  createQueryBuilder: jest.Mock;
};

const makeEventRepo = (): MockedRepo<Event> => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const makeUserRepo = (): MockedRepo<User> => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('EventsService (mocked repos)', () => {
  let eventRepo: MockedRepo<Event>;
  let userRepo: MockedRepo<User>;
  let service: EventsService;

  beforeEach(() => {
    jest.resetAllMocks();
    eventRepo = makeEventRepo();
    userRepo = makeUserRepo();
    service = new EventsService(eventRepo as unknown as Repository<Event>, userRepo as unknown as Repository<User>);
  });

  it('create: saves an event with coerced Date times and invitees', async () => {
    const alice: User = { id: 'u1', name: 'Alice', events: [] };
    const bob: User = { id: 'u2', name: 'Bob', events: [] };
    userRepo.find.mockResolvedValue([alice, bob]);

    eventRepo.create.mockImplementation((data) => data as Event);
    eventRepo.save.mockImplementation(async (e: Event) => ({ ...e, id: 'e1' } as Event));

    const created = await service.create({
      title: 'Planning',
      description: 'Sprint',
      status: EventStatus.TODO,
      startTime: '2025-09-01T10:00:00Z',
      endTime: '2025-09-01T11:00:00Z',
      inviteeIds: ['u1', 'u2'],
    });

    expect(userRepo.find).toHaveBeenCalled();
    expect(eventRepo.create).toHaveBeenCalled();
    expect(eventRepo.save).toHaveBeenCalled();
    expect(created.id).toBe('e1');
    expect(created.invitees.map((u) => u.id).sort()).toEqual(['u1', 'u2']);
    expect(created.startTime instanceof Date).toBe(true);
    expect(created.endTime instanceof Date).toBe(true);
  });

  it('findOne: returns event when found, throws NotFoundException otherwise', async () => {
    const ev: Event = {
      id: 'e2',
      title: 'Retro',
      description: 'Team retro',
      status: EventStatus.IN_PROGRESS,
      createdAt: new Date(),
      updatedAt: new Date(),
      startTime: new Date('2025-09-02T09:00:00Z'),
      endTime: new Date('2025-09-02T10:00:00Z'),
      invitees: [{ id: 'u1', name: 'Alice', events: [] }],
    } as any;
    eventRepo.findOne.mockResolvedValueOnce(ev);
    const found = await service.findOne('e2');
    expect(found).toBe(ev);

    eventRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove: deletes by id and reports status; throws if not found', async () => {
    eventRepo.delete.mockResolvedValueOnce({ affected: 1 });
    const res = await service.remove('e3');
    expect(res).toEqual({ deleted: true });

    eventRepo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mergeAllForUser: merges overlapping events, leaves standalone; unions invitees, sets status precedence', async () => {
    // Step 1: createQueryBuilder().getMany() returns ids of events for user
    const qb: any = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]),
    };
    eventRepo.createQueryBuilder.mockReturnValue(qb);

    // Step 2: find() returns full events ordered by time
    const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;
    const u1: User = { id: 'u1', name: 'Coworker', events: [] } as any;
    const e1: Event = {
      id: 'e1',
      title: 'E1',
      description: 'First',
      status: EventStatus.COMPLETED,
      createdAt: new Date(),
      updatedAt: new Date(),
      startTime: new Date('2025-09-04T10:00:00Z'),
      endTime: new Date('2025-09-04T11:00:00Z'),
      invitees: [u0],
    } as any;
    const e2: Event = {
      id: 'e2',
      title: 'E2',
      description: 'Second',
      status: EventStatus.TODO,
      createdAt: new Date(),
      updatedAt: new Date(),
      startTime: new Date('2025-09-04T10:30:00Z'),
      endTime: new Date('2025-09-04T12:00:00Z'),
      invitees: [u0, u1],
    } as any;
    const e3: Event = {
      id: 'e3',
      title: 'E3',
      description: 'Standalone',
      status: EventStatus.IN_PROGRESS,
      createdAt: new Date(),
      updatedAt: new Date(),
      startTime: new Date('2025-09-04T12:30:00Z'),
      endTime: new Date('2025-09-04T13:00:00Z'),
      invitees: [u0],
    } as any;

    eventRepo.find.mockResolvedValue([e1, e2, e3]);

    // eventRepo.create/save for merged entity
    eventRepo.create.mockImplementation((data) => ({ id: undefined, ...data }));
    eventRepo.save.mockImplementation(async (e: Event) => ({ ...e, id: 'm1' } as Event));
    eventRepo.delete.mockResolvedValue({ affected: 2 });

    const result = await service.mergeAllForUser('u0');
    expect(result.removed.sort()).toEqual(['e1', 'e2'].sort());
    expect(result.merged.length).toBe(1);
    const merged = result.merged[0];
    expect(merged.title).toMatch(/Merged/);
    expect(merged.status).toBe(EventStatus.TODO);
    expect(new Date(merged.startTime!).toISOString()).toBe(new Date('2025-09-04T10:00:00Z').toISOString());
    expect(new Date(merged.endTime!).toISOString()).toBe(new Date('2025-09-04T12:00:00Z').toISOString());

    expect(eventRepo.delete).toHaveBeenCalledWith(['e1', 'e2']);

    // ensure union invitees
    const inviteeIds = (merged.invitees || []).map((u: User) => u.id).sort();
    expect(inviteeIds).toEqual(['u0', 'u1']);
  });
});
