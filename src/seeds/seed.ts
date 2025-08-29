import dataSource from '../../data-source';  // adjust path if your data-source.ts is elsewhere
import { User } from '../users/user.entity';

async function runSeed() {
  try {
    await dataSource.initialize();

    const userRepo = dataSource.getRepository(User);

    // create demo users
    const users = userRepo.create([
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Charlie' },
    ]);

    await userRepo.save(users);

    console.log('✅ Seed complete! Inserted users:', users);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
  } finally {
    await dataSource.destroy();
  }
}

runSeed();
