import { DataSource } from 'typeorm';
import { Event } from './src/events/event.entity';
import { User } from './src/users/user.entity';

export default new DataSource({
  type: 'postgres',             // or mysql/sqlite
  host: process.env.DB_HOST || 'localhost',
  port: +process.env.DB_PORT || 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'events_dev',
  entities: [Event, User],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,           // turn OFF when using migrations
});
