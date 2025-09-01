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

const makeUserRepo = (): MockedRepo<User> => {
    const repo: MockedRepo<User> = {
        // Default to empty array; tests can override per-case
        find: jest.fn().mockResolvedValue([]),

        // By default, always "find" a user. Tests can override to return null.
        findOne: jest.fn().mockImplementation(async (arg?: any) => {
            const id =
                typeof arg === 'string'
                    ? arg
                    : arg?.where?.id ?? arg?.id ?? 'u-default';
            return { id, name: 'Mock User', events: [] } as User;
        }),

        create: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
        createQueryBuilder: jest.fn(),
    };
    return repo;
};

describe('EventsService (unit, mocks)', () => {
    let eventRepo: MockedRepo<Event>;
    let userRepo: MockedRepo<User>;
    let service: EventsService;

    beforeEach(() => {
        jest.resetAllMocks();
        eventRepo = makeEventRepo();
        userRepo = makeUserRepo();
        service = new EventsService(eventRepo as unknown as Repository<Event>, userRepo as unknown as Repository<User>);
    });

    it('create: parses dates, adds invitees, saves', async () => {
        const alice: User = { id: 'u1', name: 'Alice', events: [] };
        const bob: User = { id: 'u2', name: 'Bob', events: [] };
        userRepo.find.mockResolvedValue([alice, bob]);

        eventRepo.create.mockImplementation((data) => data as Event);
        eventRepo.save.mockImplementation(async (e: Event) => ({ ...e, id: 'e1' } as Event));

        const e1 = await service.create({
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
        expect(e1.id).toBe('e1');
        expect(e1.invitees.map((u) => u.id).sort()).toEqual(['u1', 'u2']);
        expect(e1.startTime instanceof Date).toBe(true);
        expect(e1.endTime instanceof Date).toBe(true);

        await expect(
            service.create({
                title: 'Planning',
                description: 'Sprint',
                status: EventStatus.TODO,
                startTime: '2025-09-01T10:00:00Z',
                endTime: '2025-09-01T11:00:00Z',
                inviteeIds: ['u3'],
            })
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('findOne: returns event or throws NotFound', async () => {
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

    it('remove: returns { deleted: true } or throws NotFound', async () => {
        eventRepo.delete.mockResolvedValueOnce({ affected: 1 });
        const res = await service.remove('e3');
        expect(res).toEqual({ deleted: true });

        eventRepo.delete.mockResolvedValueOnce({ affected: 0 });
        await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('mergeAllForUser', () => {
        it('merges overlapping; unions invitees; TODO > IN_PROGRESS > COMPLETED', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

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

            const inviteeIds = (merged.invitees || []).map((u: User) => u.id).sort();
            expect(inviteeIds).toEqual(['u0', 'u1']);
        });

        it('ignores non-overlapping events', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'e3' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;
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

            eventRepo.find.mockResolvedValue([e3]);

            const result = await service.mergeAllForUser('u0');
            expect(result.removed).toEqual([]);
            expect(result.merged).toEqual([]);
        });

        it('return empty lists when user has no events', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            await expect(service.mergeAllForUser('u0')).resolves.toEqual({ merged: [], removed: [] });
        });

        it('complex merge: merges clusters separately', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([
                    { id: 'a1' },
                    { id: 'a2' },
                    { id: 'b1' },
                    { id: 'b2' },
                    { id: 'b3' },
                    { id: 'c1' },
                ]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;
            const u1: User = { id: 'u1', name: 'Coworker', events: [] } as any;
            const u2: User = { id: 'u2', name: 'Guest', events: [] } as any;
            const u3: User = { id: 'u3', name: 'Client', events: [] } as any;

            // Cluster A (a1, a2) -> status should be IN_PROGRESS (beats COMPLETED)
            const a1: Event = {
                id: 'a1',
                title: 'A1',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-05T09:00:00Z'),
                endTime: new Date('2025-09-05T10:00:00Z'),
                invitees: [u0],
            } as any;
            const a2: Event = {
                id: 'a2',
                title: 'A2',
                description: '',
                status: EventStatus.IN_PROGRESS,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-05T09:30:00Z'),
                endTime: new Date('2025-09-05T11:00:00Z'),
                invitees: [u0, u1],
            } as any;

            // Cluster B (b1, b2, b3) -> status should be TODO (beats IN_PROGRESS and COMPLETED)
            const b1: Event = {
                id: 'b1',
                title: 'B1',
                description: '',
                status: EventStatus.TODO,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-05T13:00:00Z'),
                endTime: new Date('2025-09-05T14:00:00Z'),
                invitees: [u0],
            } as any;
            const b2: Event = {
                id: 'b2',
                title: 'B2',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-05T13:30:00Z'),
                endTime: new Date('2025-09-05T13:50:00Z'),
                invitees: [u2],
            } as any;
            const b3: Event = {
                id: 'b3',
                title: 'B3',
                description: '',
                status: EventStatus.IN_PROGRESS,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-05T13:45:00Z'),
                endTime: new Date('2025-09-05T14:30:00Z'),
                invitees: [u0, u3],
            } as any;

            // Standalone (should not be merged/removed)
            const c1: Event = {
                id: 'c1',
                title: 'C1',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-05T16:00:00Z'),
                endTime: new Date('2025-09-05T17:00:00Z'),
                invitees: [u0],
            } as any;

            eventRepo.find.mockResolvedValue([a1, a2, b1, b2, b3, c1]);

            eventRepo.create.mockImplementation((data) => ({ id: undefined, ...data }));
            let saveCall = 0;
            const mergedIds = ['mA', 'mB'];
            eventRepo.save.mockImplementation(async (e: Event) => ({ ...e, id: mergedIds[saveCall++] } as Event));
            eventRepo.delete.mockResolvedValue({ affected: 5 });

            const result = await service.mergeAllForUser('u0');

            // Expect two merged events
            expect(result.merged.length).toBe(2);
            // Removed should not include standalone c1
            expect(result.removed.sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'b3'].sort());

            const sortedMerged = result.merged.slice().sort(
                (x: Event, y: Event) => new Date(x.startTime as any).getTime() - new Date(y.startTime as any).getTime()
            );

            const mergedA = sortedMerged[0];
            expect(new Date(mergedA.startTime as any).toISOString()).toBe('2025-09-05T09:00:00.000Z');
            expect(new Date(mergedA.endTime as any).toISOString()).toBe('2025-09-05T11:00:00.000Z');
            expect(mergedA.status).toBe(EventStatus.IN_PROGRESS);
            expect((mergedA.invitees || []).map(u => u.id).sort()).toEqual(['u0', 'u1']);

            const mergedB = sortedMerged[1];
            expect(new Date(mergedB.startTime as any).toISOString()).toBe('2025-09-05T13:00:00.000Z');
            expect(new Date(mergedB.endTime as any).toISOString()).toBe('2025-09-05T14:30:00.000Z');
            expect(mergedB.status).toBe(EventStatus.TODO);
            expect((mergedB.invitees || []).map(u => u.id).sort()).toEqual(['u0', 'u2', 'u3']);
        });

        it('status precedence check: all COMPLETED -> merged COMPLETED', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;

            const d1: Event = {
                id: 'd1',
                title: 'D1',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-06T08:00:00Z'),
                endTime: new Date('2025-09-06T09:00:00Z'),
                invitees: [u0],
            } as any;

            const d2: Event = {
                id: 'd2',
                title: 'D2',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-06T08:30:00Z'),
                endTime: new Date('2025-09-06T09:30:00Z'),
                invitees: [u0],
            } as any;

            eventRepo.find.mockResolvedValue([d1, d2]);
            eventRepo.create.mockImplementation((data) => ({ id: undefined, ...data }));
            eventRepo.save.mockResolvedValue({ id: 'mC' } as any);
            eventRepo.delete.mockResolvedValue({ affected: 2 });

            const result = await service.mergeAllForUser('u0');

            expect(result.removed.sort()).toEqual(['d1', 'd2'].sort());
            expect(result.merged.length).toBe(1);
            const merged = result.merged[0];

            expect(merged.status).toBe(EventStatus.COMPLETED);
            expect(new Date(merged.startTime as any).toISOString()).toBe('2025-09-06T08:00:00.000Z');
            expect(new Date(merged.endTime as any).toISOString()).toBe('2025-09-06T09:30:00.000Z');
        });

        it('dedup invitees', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;
            const u1: User = { id: 'u1', name: 'A', events: [] } as any;
            const u2: User = { id: 'u2', name: 'B', events: [] } as any;

            const x1: Event = {
                id: 'x1',
                title: 'X1',
                description: '',
                status: EventStatus.IN_PROGRESS,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-07T10:00:00Z'),
                endTime: new Date('2025-09-07T11:00:00Z'),
                invitees: [u0, u1],
            } as any;

            const x2: Event = {
                id: 'x2',
                title: 'X2',
                description: '',
                status: EventStatus.TODO,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-07T10:30:00Z'),
                endTime: new Date('2025-09-07T11:30:00Z'),
                invitees: [u1, u2],
            } as any;

            const x3: Event = {
                id: 'x3',
                title: 'X3',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-07T10:45:00Z'),
                endTime: new Date('2025-09-07T12:00:00Z'),
                invitees: [u0, u2],
            } as any;

            eventRepo.find.mockResolvedValue([x1, x2, x3]);
            eventRepo.create.mockImplementation((data) => ({ id: undefined, ...data }));
            eventRepo.save.mockResolvedValue({ id: 'mX' } as any);
            eventRepo.delete.mockResolvedValue({ affected: 3 });

            const result = await service.mergeAllForUser('u0');

            expect(result.removed.sort()).toEqual(['x1', 'x2', 'x3'].sort());
            expect(result.merged.length).toBe(1);

            const merged = result.merged[0];
            const inviteeIds = (merged.invitees || []).map((u: User) => u.id).sort();
            expect(inviteeIds).toEqual(['u0', 'u1', 'u2']);
            expect(merged.status).toBe(EventStatus.TODO); // precedence TODO > IN_PROGRESS > COMPLETED
            expect(new Date(merged.startTime as any).toISOString()).toBe('2025-09-07T10:00:00.000Z');
            expect(new Date(merged.endTime as any).toISOString()).toBe('2025-09-07T12:00:00.000Z');
        });

        it('merges when one event fully contains the other (complete overlap)', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;
            const u1: User = { id: 'u1', name: 'A', events: [] } as any;
            const u2: User = { id: 'u2', name: 'B', events: [] } as any;

            const outer: Event = {
                id: 'o1',
                title: 'Outer',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-08T10:00:00Z'),
                endTime: new Date('2025-09-08T11:00:00Z'),
                invitees: [u0, u1],
            } as any;

            const inner: Event = {
                id: 'o2',
                title: 'Inner',
                description: '',
                status: EventStatus.TODO, // TODO should win
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date('2025-09-08T10:15:00Z'),
                endTime: new Date('2025-09-08T10:45:00Z'),
                invitees: [u0, u2],
            } as any;

            eventRepo.find.mockResolvedValue([outer, inner]);
            eventRepo.create.mockImplementation((data) => ({ id: undefined, ...data }));
            eventRepo.save.mockResolvedValue({ id: 'mFull' } as any);
            eventRepo.delete.mockResolvedValue({ affected: 2 });

            const result = await service.mergeAllForUser('u0');

            expect(result.removed.sort()).toEqual(['o1', 'o2'].sort());
            expect(result.merged.length).toBe(1);
            const merged = result.merged[0];

            expect(merged.status).toBe(EventStatus.TODO);
            expect(new Date(merged.startTime as any).toISOString()).toBe('2025-09-08T10:00:00.000Z');
            expect(new Date(merged.endTime as any).toISOString()).toBe('2025-09-08T11:00:00.000Z');
            expect((merged.invitees || []).map(u => u.id).sort()).toEqual(['u0', 'u1', 'u2']);
            expect(eventRepo.delete).toHaveBeenCalledWith(['o1', 'o2']);
        });

        it('merges two events with identical times and different invitees', async () => {
            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            const u0: User = { id: 'u0', name: 'Owner', events: [] } as any;
            const u1: User = { id: 'u1', name: 'A', events: [] } as any;
            const u2: User = { id: 'u2', name: 'B', events: [] } as any;

            const start = '2025-09-09T14:00:00Z';
            const end = '2025-09-09T15:00:00Z';

            const i1: Event = {
                id: 'i1',
                title: 'Identical 1',
                description: '',
                status: EventStatus.IN_PROGRESS,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date(start),
                endTime: new Date(end),
                invitees: [u0, u1],
            } as any;

            const i2: Event = {
                id: 'i2',
                title: 'Identical 2',
                description: '',
                status: EventStatus.COMPLETED,
                createdAt: new Date(),
                updatedAt: new Date(),
                startTime: new Date(start),
                endTime: new Date(end),
                invitees: [u0, u2],
            } as any;

            eventRepo.find.mockResolvedValue([i1, i2]);
            eventRepo.create.mockImplementation((data) => ({ id: undefined, ...data }));
            eventRepo.save.mockResolvedValue({ id: 'mIdent' } as any);
            eventRepo.delete.mockResolvedValue({ affected: 2 });

            const result = await service.mergeAllForUser('u0');

            expect(result.removed.sort()).toEqual(['i1', 'i2'].sort());
            expect(result.merged.length).toBe(1);
            const merged = result.merged[0];

            expect(new Date(merged.startTime as any).toISOString()).toBe(new Date(start).toISOString());
            expect(new Date(merged.endTime as any).toISOString()).toBe(new Date(end).toISOString());
            // IN_PROGRESS beats COMPLETED
            expect(merged.status).toBe(EventStatus.IN_PROGRESS);
            expect((merged.invitees || []).map(u => u.id).sort()).toEqual(['u0', 'u1', 'u2']);
            expect(eventRepo.delete).toHaveBeenCalledWith(['i1', 'i2']);
        });

        it('throws NotFound when user does not exist', async () => {
            // If service validates user existence via userRepo
            userRepo.findOne.mockResolvedValue(null);

            const qb: any = {
                leftJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 'any' }]),
            };
            eventRepo.createQueryBuilder.mockReturnValue(qb);

            await expect(service.mergeAllForUser('missing-user')).rejects.toBeInstanceOf(NotFoundException);
            expect(userRepo.findOne).toHaveBeenCalled();
        });
    });
});
